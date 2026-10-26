// SPDX-FileCopyrightText: 2026 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0

// End-to-end round trip across both Lambda handlers: the JWKS that keyrotate
// publishes must verify the token that sign issues. The unit tests pin each
// handler's output in isolation, but a consumer only cares that the two agree,
// and that the token is encoded the way JWT verifiers expect. This is the guard
// for swapping the libraries underneath (jsrsasign, base64url) without changing
// behaviour.

import { KeyObject, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  KMSClient,
  ListResourceTagsCommand,
  NotFoundException,
  SignCommand,
  Tag,
  TagResourceCommand
} from '@aws-sdk/client-kms'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'

process.env.PREVIOUS_KEY = 'alias/sts/PREVIOUS' // Read on load of the handler modules
process.env.CURRENT_KEY = 'alias/sts/CURRENT'
process.env.PENDING_KEY = 'alias/sts/PENDING'

/* eslint-disable import/no-unresolved */
import { handler as keyrotate } from '../index.keyrotate'
import { handler as signHandler } from '../index.sign'
/* eslint-enable import/no-unresolved */

const kmsMock = mockClient(KMSClient)
const s3Mock = mockClient(S3Client)

const CURRENT_KEY_ID = 'key-current'
const ROLE_USER_ARN = 'arn:aws:sts:eu-central-1:123456789012:assumed-role/this-is-my-role-name/this-is-my-username'

// RFC 7515 base64url: URL-safe alphabet, no padding. Node's base64url decoder
// also accepts the standard alphabet and padding, so decoding alone would not
// catch a regression to plain base64 -- this pattern does.
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/

// Five consecutive '?' (0x3F) or '>' (0x3E) always contain one 3-byte group
// aligned on a base64 boundary, whatever precedes them in the JSON, and those
// groups encode to 'Pz8/' and 'Pj4+'. So this audience guarantees both '/' and
// '+' would appear in a payload encoded with the standard alphabet.
const AUDIENCE_FORCING_PLUS_AND_SLASH = '?????>>>>>'

describe('keyrotate JWKS verifies sign token', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    kmsMock.reset()
    s3Mock.reset()
    process.env = { ...OLD_ENV, S3_BUCKET: 'test-bucket-name', ISSUER: 'https://test-issuer.com' }
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  test('token issued by sign verifies against the JWKS published by keyrotate', async () => {
    // A real key pair stands in for the KMS key, so the signature is genuine.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const kmsTags: Tag[] = []
    const uploads: Record<string, any> = {}

    kmsMock
      .on(DescribeKeyCommand).rejects(new NotFoundException({ message: 'not found', $metadata: {} }))
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' }).resolves({ KeyMetadata: { KeyId: CURRENT_KEY_ID } })
      .on(GetPublicKeyCommand, { KeyId: 'alias/sts/CURRENT' }).resolves({
        PublicKey: publicKey.export({ format: 'der', type: 'spki' })
      })
      .on(TagResourceCommand).callsFake((input) => {
        kmsTags.push(...input.Tags)
        return {}
      })
      .on(ListResourceTagsCommand, { KeyId: CURRENT_KEY_ID }).callsFake(() => ({ Tags: kmsTags }))
      .on(SignCommand, { KeyId: CURRENT_KEY_ID }).callsFake((input) => ({
        Signature: sign('sha256', input.Message, privateKey)
      }))

    s3Mock.on(PutObjectCommand).callsFake((input) => {
      uploads[input.Key] = JSON.parse(input.Body.toString())
      return {}
    })

    await keyrotate({ step: 'generateArtifacts' })

    const response = await signHandler({
      requestContext: { identity: { userArn: ROLE_USER_ARN } },
      queryStringParameters: { aud: AUDIENCE_FORCING_PLUS_AND_SLASH }
    } as any, {} as any)

    expect(response.statusCode).toBe(200)
    const { token } = JSON.parse(response.body)

    // Compact JWS: three base64url segments, none padded or standard-alphabet.
    const segments = token.split('.')
    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment).toMatch(BASE64URL_SEGMENT)
    }
    const [encodedHeader, encodedPayload, encodedSignature] = segments

    // The kid in the token header selects a key from the published JWKS.
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: expect.any(String) })

    const jwks = uploads['discovery/keys']
    expect(jwks.keys).toHaveLength(1)
    const jwk = jwks.keys.find((key: any) => key.kid === header.kid)
    expect(jwk).toBeDefined()
    expect(jwk).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' })

    // The published key is the KMS public key, not merely some valid key.
    const publishedKey: KeyObject = createPublicKey({ key: jwk, format: 'jwk' })
    expect(publishedKey.equals(publicKey)).toBe(true)

    // And it verifies the signature over exactly "<header>.<payload>".
    const signedInput = Buffer.from(`${encodedHeader}.${encodedPayload}`)
    expect(verify('sha256', signedInput, publishedKey, Buffer.from(encodedSignature, 'base64url'))).toBe(true)

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
    expect(payload).toMatchObject({
      sub: 'arn:aws:iam:eu-central-1:123456789012:role/this-is-my-role-name',
      aud: AUDIENCE_FORCING_PLUS_AND_SLASH,
      iss: 'https://test-issuer.com'
    })
  })
})
