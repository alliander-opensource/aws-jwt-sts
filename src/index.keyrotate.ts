// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0

import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  GetPublicKeyCommand,
  KMSClient,
  NotFoundException,
  ScheduleKeyDeletionCommand,
  Tag,
  TagResourceCommand,
  UpdateAliasCommand
} from '@aws-sdk/client-kms'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { KEYUTIL, KJUR } from 'jsrsasign'

const client = new KMSClient({})

const ALIAS_PREVIOUS = process.env.PREVIOUS_KEY!.toString()
const ALIAS_CURRENT = process.env.CURRENT_KEY!.toString()
const ALIAS_PENDING = process.env.PENDING_KEY!.toString()

const ALIASES: string[] = [
  ALIAS_PREVIOUS,
  ALIAS_CURRENT,
  ALIAS_PENDING
]

export const handler = async (event: any): Promise<any> => {
  // Retrieve the step from the event
  const {step} = event

  // Match the step with the corresponding function
  switch (step) {
    case 'deletePrevious':
      await deletePrevious()
      break
    case 'movePrevious':
      await movePrevious()
      break
    case 'moveCurrent':
      await moveCurrent()
      break
    case 'createPending':
      await createPending()
      break
    case 'generateArtifacts':
      await generateJWKS()
      await generateOpenIDConfiguration()
      break

    default:
      console.log('invalid step')
  }
}

async function deletePrevious () {
  console.log('Deleting PREVIOUS aliased key')

  const prevKeyId = await getKeyIdForAlias(ALIAS_PREVIOUS)
  if (prevKeyId) {
    const ScheduleDeleteResponse = await client.send(
      new ScheduleKeyDeletionCommand({ KeyId: prevKeyId })
    )
    console.log(ScheduleDeleteResponse)
  } else {
    console.log('No PREVIOUS key at the moment, skip deletion')
  }
}

async function movePrevious () {
  console.log('moving PREVIOUS alias')
  const currentKeyId = await getKeyIdForAlias(ALIAS_CURRENT)
  if (currentKeyId) {
    await updateOrCreateAlias(ALIAS_PREVIOUS, currentKeyId)
  } else {
    console.log('No CURRENT key at the moment, skip assigning the PREVIOUS alias to this key.')
  }
}

async function moveCurrent () {
  console.log('Moving CURRENT alias')

  const pendingKeyId = await getKeyIdForAlias(ALIAS_PENDING)
  if (pendingKeyId) {
    await updateOrCreateAlias(ALIAS_CURRENT, pendingKeyId)
  } else {
    console.log('No PENDING key at the moment, skip assigning the CURRENT alias to this key.')
  }
}

async function createPending () {
  console.log('Creating new key for PENDING')

  // Create new key
  const createResponse = await client.send(new CreateKeyCommand({
    KeySpec: 'RSA_2048',
    KeyUsage: 'SIGN_VERIFY'
  }))
  console.log(createResponse)

  // Update the new key with pending alias
  await updateOrCreateAlias(ALIAS_PENDING, createResponse.KeyMetadata!.KeyId!)
}

async function updateOrCreateAlias (aliasName: string, keyId: string) {
  try {
    const updateResponse = await client.send(new UpdateAliasCommand({
      AliasName: aliasName,
      TargetKeyId: keyId
    }))
    console.log(updateResponse)
  } catch (err) {
    if (err instanceof NotFoundException) {
      console.log('ALIAS not found, creating it.')
      const createResponse = await client.send(new CreateAliasCommand({
        AliasName: aliasName,
        TargetKeyId: keyId
      }))
      console.log(createResponse)
    } else {
      throw (err)
    }
  }
}

async function getKeyIdForAlias (keyId: string) {
  try {
    const response = await client.send(new DescribeKeyCommand({ KeyId: keyId }))
    console.log(response)
    return response.KeyMetadata?.KeyId
  } catch (err) {
    if (err instanceof NotFoundException) {
      return null
    } else {
      throw err
    }
  }
}

async function generateJWKS () {
  const allKeys: object[] = []

  for (const keyAlias of ALIASES) {
    const keyId = await getKeyIdForAlias(keyAlias)
    if (keyId) {
      const jwkContents = await generateJWK(keyAlias)
      await setKMSKeyTags(keyId, [{ TagKey: 'jwk_kid', TagValue: jwkContents.kid }])
      allKeys.push(jwkContents)
    }
  }

  const result = { keys: allKeys }

  await uploadToS3('discovery/keys', result)
}

async function generateOpenIDConfiguration () {
  const issuer = process.env.ISSUER

  const openIdConfiguration = {
    issuer,
    jwks_uri: `${issuer}/discovery/keys`,
    response_types_supported: [
      'token'
    ],
    id_token_signing_alg_values_supported: [
      'RS256'
    ],
    scopes_supported: [
      'openid'
    ],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic'
    ],
    claims_supported: [
      'aud',
      'exp',
      'iat',
      'iss',
      'sub'
    ]
  }

  await uploadToS3('.well-known/openid-configuration', openIdConfiguration)
}

async function generateJWK (keyAlias: string): Promise<any> {
  // Get the public key from kms
  const getPubKeyResponse = await client.send(new GetPublicKeyCommand({ KeyId: keyAlias }))

  // Generate HEX format from the response (DER)
  const pubKeyHex = Buffer.from(getPubKeyResponse.PublicKey as Uint8Array).toString('hex')

  // Get the pub key in pem format
  const pubKeyPem = KJUR.asn1.ASN1Util.getPEMStringFromHex(pubKeyHex, 'PUBLIC KEY')

  // Return the JWK format for the key
  const jwk: any = KEYUTIL.getJWK(pubKeyPem)

  jwk.use = 'sig'
  jwk.alg = 'RS256'

  return jwk
}

async function setKMSKeyTags (keyAlias: string, tags: Tag[]) {
  return await client.send(new TagResourceCommand({ KeyId: keyAlias, Tags: tags }))
}

async function uploadToS3 (key: string, contents: object) {
  // Get S3 bucket from environment variables
  const s3Bucket = process.env.S3_BUCKET

  const s3client = new S3Client({})

  // Write jwk to s3 bucket
  await s3client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key, // File name you want to save as in S3
    Body: Buffer.from(JSON.stringify(contents)),
    ContentType: 'application/json',
    ContentEncoding: ''
  }))
}
