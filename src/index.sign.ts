// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0

import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda'
import { KMSClient, SignCommand, DescribeKeyCommand, ListResourceTagsCommand, Tag } from '@aws-sdk/client-kms'
import base64url from 'base64url'

import { Logger } from '@aws-lambda-powertools/logger'

const KEY_ALIAS_CURRENT = 'alias/sts/CURRENT'
const logger = new Logger()

export const handler = async (apiEvent: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const identityArn = getARNFromIdentity(apiEvent.requestContext.identity?.userArn)
  logger.debug(identityArn!)

  if (identityArn === undefined || identityArn === null) {
    logger.info(`Unable to resolve identityArn for userArn: ${apiEvent.requestContext.identity?.userArn}`)
    return respond('Unable to resolve identity', 400)
  }

  let aud = process.env.DEFAULT_AUDIENCE

  if (apiEvent.queryStringParameters && apiEvent.queryStringParameters.aud) {
    aud = apiEvent.queryStringParameters.aud
  }

  const kms = new KMSClient({})

  // Get KeyID which will be sent as kid in JWT token
  const currentResponse = await kms.send(new DescribeKeyCommand({ KeyId: `${KEY_ALIAS_CURRENT}` }))
  const currentKeyId = currentResponse.KeyMetadata?.KeyId

  if (currentKeyId === undefined) {
    return respond('KMS key could not be retrieved', 500)
  }

  // Retrieve Tags for KMS Key - the key is tagged with the `kid` from the JWK which is used in the JWT headers
  const listResourceTagsResponse = await kms.send(new ListResourceTagsCommand({ KeyId: currentKeyId }))
  const kid = getTagValueFromTags('jwk_kid', listResourceTagsResponse.Tags ?? [])

  if (kid == null) {
    return respond('KMS key is not correctly tagged', 500)
  }

  const iss = process.env.ISSUER

  // JWT Token headers
  const headers: any = {
    alg: 'RS256',
    typ: 'JWT',
    kid: `${kid}`
  }

  // prepare token lifetime property values
  const issuedAtDate = new Date()
  const expirationDate = new Date(issuedAtDate)
  const notBeforeDate = new Date(issuedAtDate)
  expirationDate.setTime(expirationDate.getTime() + 60 * 60 * 1000) // valid for one hour
  notBeforeDate.setTime(notBeforeDate.getTime() - 5 * 60 * 1000) // 5m before issuedAtDate

  // JWT Token payload
  const payload: any = {
    sub: `${identityArn}`, // Set role arn as message for payload
    aud,
    iss,
    iat: Math.floor(issuedAtDate.getTime() / 1000),
    exp: Math.floor(expirationDate.getTime() / 1000),
    nbf: Math.floor(notBeforeDate.getTime() / 1000)
  }

  // Prepare message to be signed by KMS
  const tokenHeaders = base64url(JSON.stringify(headers))
  const tokenPayload = base64url(JSON.stringify(payload))

  // Sign message with KMS
  const signResponse = await kms.send(new SignCommand({
    KeyId: currentKeyId,
    Message: Buffer.from(`${tokenHeaders}.${tokenPayload}`),
    SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    MessageType: 'RAW'
  }))
  logger.debug(JSON.stringify(signResponse))

  const signature = Buffer
    .from(signResponse.Signature as Uint8Array)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const token = `${tokenHeaders}.${tokenPayload}.${signature}`
  logger.debug(token)

  return respond(JSON.stringify({
    token
  }))
}

function respond (message: string, statusCode: number = 200) {
  return {
    statusCode,
    body: message
  }
}

function getARNFromIdentity (identityArn: string | null) {
  if (identityArn === undefined || identityArn === null) {
    return null
  }

  // Regex for converting arn to base role
  const captGroups = [
    'arn:aws:sts:',
    '(?<regionName>[^:]*)', // group 1
    ':',
    '(?<accountId>\\d{12})', // group 2
    ':assumed-role\\/',
    '(?<roleName>[A-z0-9\\-]+?)', // group 3
    '\\/',
    '(?<user>[^:]*)', // group 4
    '$'
  ]

  const regex = new RegExp(captGroups.join(''))
  const { regionName, accountId, roleName } = regex.exec(identityArn)?.groups ?? {}

  if (regionName === undefined || accountId === undefined || roleName === undefined) {
    return null
  }

  // Build base role arn
  return `arn:aws:iam:${regionName}:${accountId}:role/${roleName}`
}

function getTagValueFromTags (tagKey: string, tags: Tag[]) {
  for (const tag of tags) {
    if (tag.TagKey === tagKey) {
      return tag.TagValue
    }
  }

  return null
}
