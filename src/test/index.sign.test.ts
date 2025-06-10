// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable import/no-unresolved */
import {
  DescribeKeyCommand,
  KMSClient,
  ListResourceTagsCommand,
  SignCommand
} from '@aws-sdk/client-kms'
import { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { jwtDecode as jwt_decode } from 'jwt-decode'

process.env.CURRENT_KEY = 'key-1'// Set env var as it is called on load of the file
import { handler } from '../index.sign'
import { env } from 'process'

const kmsMock = mockClient(KMSClient)

const VALID_IDENTITY_USER_ARN = 'arn:aws:sts:eu-central-1:123456789012:assumed-role/this-is-my-role-name/this-is-my-username'

const VALID_EVENT: APIGatewayProxyEvent = {
  requestContext: {
    identity: {
      userArn: VALID_IDENTITY_USER_ARN
    }
  }
} as any

const CONTEXT: Context = {} as any

describe('handlers/sign/sign.ts', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    kmsMock.reset()
    process.env = { ...OLD_ENV }
  })

  afterEach(() => {
    kmsMock.reset()
    process.env = OLD_ENV
  })

  test('it should respond bad request if no userIdentity is passed', async () => {
    const event: APIGatewayProxyEvent = {
      requestContext: {
      }
    } as any

    const response = await handler(event, CONTEXT)

    expect(response.statusCode).toEqual(400)
    expect(response.body).toEqual('Unable to resolve identity')
  })

  test('it should respond bad request if an invalid userIdentity is passed', async () => {
    const invalidServiceResponse = await handler({
      requestContext: {
        identity: {
          userArn: 'arn:aws:invalid-service:eu-central-1:123456789012:assumed-role/this-is-my-role-name/this-is-my-username'
        }
      }
    } as any, CONTEXT)

    expect(invalidServiceResponse.statusCode).toEqual(400)
    expect(invalidServiceResponse.body).toEqual('Unable to resolve identity')

    const invalidAccountIdResponse = await handler({
      requestContext: {
        identity: {
          userArn: 'arn:aws:sts:eu-central-1:account-id:assumed-role/this-is-my-role-name/this-is-my-username'
        }
      }
    } as any, CONTEXT)

    expect(invalidAccountIdResponse.statusCode).toEqual(400)
    expect(invalidAccountIdResponse.body).toEqual('Unable to resolve identity')

    const completelyInvalidArn = await handler({
      requestContext: {
        identity: {
          userArn: 'i-am-not-even-trying'
        }
      }
    } as any, CONTEXT)

    expect(completelyInvalidArn.statusCode).toEqual(400)
    expect(completelyInvalidArn.body).toEqual('Unable to resolve identity')
  })

  test('it should respond internal server error if no tag is present on the KMS key', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({
        KeyMetadata: {
          KeyId: 'key-1'
        }
      })
      .on(ListResourceTagsCommand).resolves({
        Tags: [
          {
            TagKey: 'NotTheKid',
            TagValue: 'I won\'t be resolved'
          }
        ]
      })

    const response = await handler(VALID_EVENT, CONTEXT)

    expect(response.statusCode).toEqual(500)
    expect(response.body).toEqual('KMS key is not correctly tagged')
  })

  test('it should respond internal server error if the KeyId is not in the metadata', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({})

    const response = await handler(VALID_EVENT, CONTEXT)

    expect(response.statusCode).toEqual(500)
    expect(response.body).toEqual('KMS key could not be retrieved')
  })

  test('should sign correctly', async () => {
    jest
      .useFakeTimers()
      .setSystemTime(new Date('2020-01-01'))

    const b64Signature = Buffer.from('i-am-a-signature').toString('base64')
    const signature = base64ToArrayBuffer(b64Signature)

    kmsMock
      .on(DescribeKeyCommand).resolves({
        KeyMetadata: {
          KeyId: 'key-1'
        }
      })
      .on(ListResourceTagsCommand).resolves({
        Tags: [
          {
            TagKey: 'jwk_kid',
            TagValue: 'I am the KID from the JWK'
          }
        ]
      })
      .on(SignCommand).resolves({
        Signature: signature
      })

    process.env.ISSUER = 'https://test-issuer.com'
    process.env.DEFAULT_AUDIENCE = 'api://default-aud'

    const response = await handler(VALID_EVENT, CONTEXT)

    expect(response.statusCode).toEqual(200)
    const responseBody = JSON.parse(response.body)
    const {token} = responseBody

    const decodedHeader: any = jwt_decode(token, { header: true })

    expect(decodedHeader.alg).toEqual('RS256')
    expect(decodedHeader.typ).toEqual('JWT')
    expect(decodedHeader.kid).toEqual('I am the KID from the JWK')

    const decodedToken: any = jwt_decode(token)
    expect(decodedToken.sub).toEqual('arn:aws:iam:eu-central-1:123456789012:role/this-is-my-role-name')
    expect(decodedToken.aud).toEqual('api://default-aud')
    expect(decodedToken.iss).toEqual('https://test-issuer.com')
    expect(decodedToken.exp - decodedToken.iat).toEqual(3600)
    expect(decodedToken.iat - decodedToken.nbf).toEqual(300)

    const tokenParts = responseBody.token.split('.')
    expect(tokenParts[2]).toEqual(`${b64Signature.replace('==', '')}`)
  })
})

describe('handlers/sign/sign.ts - additional coverage', () => {
  const CONTEXT = {} as any
  const OLD_ENV = process.env
  const kmsMock = mockClient(KMSClient)

  beforeEach(() => {
    jest.resetModules()
    kmsMock.reset()
    process.env = { ...OLD_ENV }
  })

  afterEach(() => {
    kmsMock.reset()
    process.env = OLD_ENV
  })

  test('should use aud from queryStringParameters', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({ KeyMetadata: { KeyId: 'key-1' } })
      .on(ListResourceTagsCommand).resolves({ Tags: [{ TagKey: 'jwk_kid', TagValue: 'thekid' }] })
      .on(SignCommand).resolves({ Signature: Buffer.from('sig') })
    const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } },
      queryStringParameters: { aud: 'custom-aud' }
    } as any
    const response = await handler(event, CONTEXT)
    const token = JSON.parse(response.body).token

    expect(response.statusCode).toBe(200)
    expect(token).toBeDefined()

    const decodedToken: any = jwt_decode(token)
    expect(decodedToken.aud).toBe('custom-aud')
  })

  test('should handle missing queryStringParameters', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({ KeyMetadata: { KeyId: 'key-1' } })
      .on(ListResourceTagsCommand).resolves({ Tags: [{ TagKey: 'jwk_kid', TagValue: 'thekid' }] })
      .on(SignCommand).resolves({ Signature: Buffer.from('sig') })

      const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } }
    } as any

    env.DEFAULT_AUDIENCE = 'default-aud'
    env.ISSUER = 'https://default-issuer.com'

    const response = await handler(event, CONTEXT)
    const token = JSON.parse(response.body).token
    expect(response.statusCode).toBe(200)
    expect(token).toBeDefined()

    const decodedToken: any = jwt_decode(token)
    expect(decodedToken.aud).toBe(process.env.DEFAULT_AUDIENCE)
    expect(decodedToken.iss).toBe(process.env.ISSUER)
    expect(decodedToken.sub).toBe('arn:aws:iam:eu-central-1:123456789012:role/this-is-my-role-name')
  })

  test('should handle missing ISSUER env', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({ KeyMetadata: { KeyId: 'key-1' } })
      .on(ListResourceTagsCommand).resolves({ Tags: [{ TagKey: 'jwk_kid', TagValue: 'thekid' }] })
      .on(SignCommand).resolves({ Signature: Buffer.from('sig') })

    env.DEFAULT_AUDIENCE = 'default-aud'
    process.env.ISSUER = undefined
    const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } }
    } as any
    const response = await handler(event, CONTEXT)
    const token = JSON.parse(response.body).token
    expect(response.statusCode).toBe(200)
    expect(token).toBeDefined()

    const decodedToken: any = jwt_decode(token)
    expect(decodedToken.iss).toBeUndefined()
    expect(decodedToken.aud).toBe(process.env.DEFAULT_AUDIENCE)
    expect(decodedToken.sub).toBe('arn:aws:iam:eu-central-1:123456789012:role/this-is-my-role-name')
  })

  test('should handle missing tag value in getTagValueFromTags', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({ KeyMetadata: { KeyId: 'key-1' } })
      .on(ListResourceTagsCommand).resolves({ Tags: [{ TagKey: 'not_jwk_kid', TagValue: 'nope' }] })
    const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } }
    } as any
    const response = await handler(event, CONTEXT)
    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual('KMS key is not correctly tagged')
  })

  test('should handle missing KeyId in DescribeKeyCommand', async () => {
    kmsMock.on(DescribeKeyCommand).resolves({})
    const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } }
    } as any
    const response = await handler(event, CONTEXT)
    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual('KMS key could not be retrieved')
  })

  test('should handle missing userArn', async () => {
    const event = {
      requestContext: { identity: {} }
    } as any
    const response = await handler(event, CONTEXT)
    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual('Unable to resolve identity')
  })

  test('should handle completely invalid arn', async () => {
    const event = {
      requestContext: { identity: { userArn: 'not-an-arn' } }
    } as any
    const response = await handler(event, CONTEXT)
    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual('Unable to resolve identity')
  })

  test('should handle error when ListResourceTagsCommand returns undefined', async () => {
    kmsMock
      .on(DescribeKeyCommand).resolves({ KeyMetadata: { KeyId: 'key-1' } })
      .on(ListResourceTagsCommand).resolves({ undefined } as any ) // Simulating undefined response

    const event = {
      requestContext: { identity: { userArn: VALID_IDENTITY_USER_ARN } }
    } as any
    const response = await handler(event, CONTEXT)
    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual('KMS key is not correctly tagged')
  })
})

function base64ToArrayBuffer (b64: string) {
  const byteString = atob(b64)
  const byteArray = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    byteArray[i] = byteString.charCodeAt(i)
  }

  return byteArray
}
