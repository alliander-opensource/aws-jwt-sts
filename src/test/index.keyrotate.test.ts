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
  UpdateAliasCommand
} from '@aws-sdk/client-kms'
import { S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'

process.env = { // Set env vars as they are called on load of the file
  CURRENT_KEY: 'alias/sts/CURRENT',
  PREVIOUS_KEY: 'alias/sts/PREVIOUS',
  PENDING_KEY: 'alias/sts/PENDING'
}

/* eslint-disable-next-line import/no-unresolved */
import { handler } from '../index.keyrotate'

const kmsMock = mockClient(KMSClient)
const s3Mock = mockClient(S3Client)

const pubKeys = {
  PREVIOUS: {
    pem: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt0O+biOuAYD5FrM2R6dAliN1v9HA5XpsuoAtXTn8OVKsLvvBFEhBFlghvSXPpu71vE/JYpUj0lL7J54o/RmCz9ZRDzojLU7aWEYM2sEC9nO2ITdu8it+rr3faa70+7PGW09o4iFD+mXYUgadYT8VWxrKQ3eV/LQrSM+6/KYl3BhlNZNxwjtbHGWAldOlzvy14I59GU5W/zDPgOIWSQBbpRvoJKT2rzOZYDtn7C62197hJYAU7QIZ4mOz/ia10ayFFI7p2Uogku3tY5cyYEtSWGzlTL3EiEzSvvsfQ0717bA5ybbDqCWtShg8+IoOxmby4K9X7XuGAQZYE/fgNAXg3wIDAQAB',
    jwk_kid: 'reND9IAI5hj2pe8UfKm2X6r-SjW1v7s23oC3_N5WPiQ'
  },
  CURRENT: {
    pem: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA/PC3f+8XOs6yway2FhPLdZrWU67RIqFACSPJ0A4q/eJ8GlGXDj8cxHcJBJyvTxEU/rttSe3f44ZfrvwlDUbgAmTi2zYEDrBRHr+LmR6qoyvczLNZkiMmJZygdeOMT87gPx1fb8hhFAXQkOL8dHKiBZ+s4Hls8yu5eMuBhjh+hUYxEQWw0ilDgaXCaGRjooHPSU6+I+Qbm73MuCbBAyzSIAGDKyyD50Kx9Z9Cc0i+6ZfXwWU/2Sda7u4U4R2B/PkhAy0fIjn7kMaw9sgpdQHHxygxQ8y7PduNgDBF/C1zOeKJuRa3QGoMXY9kn/OVBwnZG7bQ9Enz3RnTkM3q0nf9JQIDAQAB',
    jwk_kid: '-NIJE4RQ8NYWrOOh5_JyGKFAobfY5_oCKo1MrNXoQOg'
  },
  PENDING: {
    pem: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzeWAt2aRiX57vDd78OwF+83IdEI0mWh05hXvAzQXMqt+QR49hiIWjJtYh1B3sYvbp9BWC8yo+BlWWtsI5fu5mCXsBBp/Q/sgfArEsji+dWEXc+xGRN3hptb9tT+sabIWmd6Qyw4dYCksrBzJvSLO+Hi10Otd2NtzYbAqjZ6soaaClSnrOiw9+J4/GFHuY5gOw8P0uaMclI5sDLGN+G/ayGpUK7xegfEAd9VB6mhdgWoYEAT6yEDnFt0BwvTOYT6TI/5v6scRE7Bywsq5V2Mz5VZe43POcSt1n7vIZ9cXXHSGW8JPv1KKcniHsxIc3Fc74OjcEbqWKw49kVGCE3ayfQIDAQAB',
    jwk_kid: 'bHyjPYB3AfII8o_X3tGkOCVzThZzQN2UKwKVCO9E9gY'
  }
}

describe('handlers/keyrotate/keyrotate.test.ts', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    kmsMock.reset()
    s3Mock.reset()
    process.env = { ...OLD_ENV }
  })

  afterEach(() => {
    kmsMock.reset()
    s3Mock.reset()
    process.env = OLD_ENV
  })

  test('should generate & upload correct JWKS file to S3', async () => {
    kmsMock
      .on(GetPublicKeyCommand, { KeyId: 'alias/sts/PREVIOUS' }).resolves({
        PublicKey: base64ToArrayBuffer(pubKeys.PREVIOUS.pem)
      })
      .on(GetPublicKeyCommand, { KeyId: 'alias/sts/CURRENT' }).resolves({
        PublicKey: base64ToArrayBuffer(pubKeys.CURRENT.pem)
      })
      .on(GetPublicKeyCommand, { KeyId: 'alias/sts/PENDING' }).resolves({
        PublicKey: base64ToArrayBuffer(pubKeys.PENDING.pem)
      })
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PREVIOUS' }).resolves({
        KeyMetadata: {
          KeyId: 'key-1'
        }
      })
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' }).resolves({
        KeyMetadata: {
          KeyId: 'key-2'
        }
      })
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PENDING' }).resolves({
        KeyMetadata: {
          KeyId: 'key-3'
        }
      })

    process.env.S3_BUCKET = 'test-bucket-name'
    process.env.ISSUER = 'test-issuer.com'

    await handler({ step: 'generateArtifacts' })

    // @ts-ignore
    const tagsPrevious = kmsMock.call(2).args[0].input.Tags
    expect(tagsPrevious[0].TagKey).toBe('jwk_kid')
    expect(tagsPrevious[0].TagValue).toBe(pubKeys.PREVIOUS.jwk_kid)

    // @ts-ignore
    const tagsCurrent = kmsMock.call(5).args[0].input.Tags
    expect(tagsCurrent[0].TagKey).toBe('jwk_kid')
    expect(tagsCurrent[0].TagValue).toBe(pubKeys.CURRENT.jwk_kid)

    // @ts-ignore
    const tagsPending = kmsMock.call(8).args[0].input.Tags
    expect(tagsPending[0].TagKey).toBe('jwk_kid')
    expect(tagsPending[0].TagValue).toBe(pubKeys.PENDING.jwk_kid)

    // @ts-ignore
    const s3Key = s3Mock.call(0).args[0].input.Key
    expect(s3Key).toBe('discovery/keys')

    // @ts-ignore
    const s3Bucket = s3Mock.call(0).args[0].input.Bucket
    expect(s3Bucket).toBe('test-bucket-name')

    // @ts-ignore
    const s3Body = JSON.parse(s3Mock.call(0).args[0].input.Body.toString())
    expect(s3Body).toEqual({
      keys: [
        {
          e: 'AQAB',
          kid: 'reND9IAI5hj2pe8UfKm2X6r-SjW1v7s23oC3_N5WPiQ',
          kty: 'RSA',
          n: 't0O-biOuAYD5FrM2R6dAliN1v9HA5XpsuoAtXTn8OVKsLvvBFEhBFlghvSXPpu71vE_JYpUj0lL7J54o_RmCz9ZRDzojLU7aWEYM2sEC9nO2ITdu8it-rr3faa70-7PGW09o4iFD-mXYUgadYT8VWxrKQ3eV_LQrSM-6_KYl3BhlNZNxwjtbHGWAldOlzvy14I59GU5W_zDPgOIWSQBbpRvoJKT2rzOZYDtn7C62197hJYAU7QIZ4mOz_ia10ayFFI7p2Uogku3tY5cyYEtSWGzlTL3EiEzSvvsfQ0717bA5ybbDqCWtShg8-IoOxmby4K9X7XuGAQZYE_fgNAXg3w',
          alg: 'RS256',
          use: 'sig'
        }, {
          e: 'AQAB',
          kid: '-NIJE4RQ8NYWrOOh5_JyGKFAobfY5_oCKo1MrNXoQOg',
          kty: 'RSA',
          n: '_PC3f-8XOs6yway2FhPLdZrWU67RIqFACSPJ0A4q_eJ8GlGXDj8cxHcJBJyvTxEU_rttSe3f44ZfrvwlDUbgAmTi2zYEDrBRHr-LmR6qoyvczLNZkiMmJZygdeOMT87gPx1fb8hhFAXQkOL8dHKiBZ-s4Hls8yu5eMuBhjh-hUYxEQWw0ilDgaXCaGRjooHPSU6-I-Qbm73MuCbBAyzSIAGDKyyD50Kx9Z9Cc0i-6ZfXwWU_2Sda7u4U4R2B_PkhAy0fIjn7kMaw9sgpdQHHxygxQ8y7PduNgDBF_C1zOeKJuRa3QGoMXY9kn_OVBwnZG7bQ9Enz3RnTkM3q0nf9JQ',
          alg: 'RS256',
          use: 'sig'
        }, {
          e: 'AQAB',
          kid: 'bHyjPYB3AfII8o_X3tGkOCVzThZzQN2UKwKVCO9E9gY',
          kty: 'RSA',
          n: 'zeWAt2aRiX57vDd78OwF-83IdEI0mWh05hXvAzQXMqt-QR49hiIWjJtYh1B3sYvbp9BWC8yo-BlWWtsI5fu5mCXsBBp_Q_sgfArEsji-dWEXc-xGRN3hptb9tT-sabIWmd6Qyw4dYCksrBzJvSLO-Hi10Otd2NtzYbAqjZ6soaaClSnrOiw9-J4_GFHuY5gOw8P0uaMclI5sDLGN-G_ayGpUK7xegfEAd9VB6mhdgWoYEAT6yEDnFt0BwvTOYT6TI_5v6scRE7Bywsq5V2Mz5VZe43POcSt1n7vIZ9cXXHSGW8JPv1KKcniHsxIc3Fc74OjcEbqWKw49kVGCE3ayfQ',
          alg: 'RS256',
          use: 'sig'
        }]
    })

    // @ts-ignore
    const s3KeyOpenidConfiguration = s3Mock.call(1).args[0].input.Key
    expect(s3KeyOpenidConfiguration).toBe('.well-known/openid-configuration')

    // @ts-ignore
    const s3BodyOpenidConfiguration = JSON.parse(s3Mock.call(1).args[0].input.Body.toString())
    expect(s3BodyOpenidConfiguration).toEqual({
      issuer: 'test-issuer.com',
      jwks_uri: 'test-issuer.com/discovery/keys',
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
    })
  })

  // --- deletePrevious step ---

  test('deletePrevious should schedule key deletion when PREVIOUS alias exists', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PREVIOUS' })
      .resolves({ KeyMetadata: { KeyId: 'key-prev-123' } })

    await handler({ step: 'deletePrevious' })

    const deleteCalls = kmsMock.commandCalls(ScheduleKeyDeletionCommand)
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].args[0].input.KeyId).toBe('key-prev-123')
  })

  test('deletePrevious should skip deletion when PREVIOUS alias does not exist', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PREVIOUS' })
      .rejects(new NotFoundException({ message: 'not found', $metadata: {} }))

    await handler({ step: 'deletePrevious' })

    const deleteCalls = kmsMock.commandCalls(ScheduleKeyDeletionCommand)
    expect(deleteCalls).toHaveLength(0)
  })

  test('deletePrevious should rethrow non-NotFoundException errors', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PREVIOUS' })
      .rejects(new Error('AccessDenied'))

    await expect(handler({ step: 'deletePrevious' })).rejects.toThrow('AccessDenied')
  })

  // --- movePrevious step ---

  test('movePrevious should update PREVIOUS alias to point to CURRENT key', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .resolves({ KeyMetadata: { KeyId: 'key-current-456' } })

    await handler({ step: 'movePrevious' })

    const updateCalls = kmsMock.commandCalls(UpdateAliasCommand)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].args[0].input.AliasName).toBe('alias/sts/PREVIOUS')
    expect(updateCalls[0].args[0].input.TargetKeyId).toBe('key-current-456')
  })

  test('movePrevious should skip when CURRENT alias does not exist', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .rejects(new NotFoundException({ message: 'not found', $metadata: {} }))

    await handler({ step: 'movePrevious' })

    const updateCalls = kmsMock.commandCalls(UpdateAliasCommand)
    const createCalls = kmsMock.commandCalls(CreateAliasCommand)
    expect(updateCalls).toHaveLength(0)
    expect(createCalls).toHaveLength(0)
  })

  test('movePrevious should create alias when UpdateAlias throws NotFoundException', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .resolves({ KeyMetadata: { KeyId: 'key-current-456' } })
      .on(UpdateAliasCommand)
      .rejects(new NotFoundException({ message: 'alias not found', $metadata: {} }))

    await handler({ step: 'movePrevious' })

    const createCalls = kmsMock.commandCalls(CreateAliasCommand)
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].args[0].input.AliasName).toBe('alias/sts/PREVIOUS')
    expect(createCalls[0].args[0].input.TargetKeyId).toBe('key-current-456')
  })

  test('movePrevious should rethrow non-NotFoundException from UpdateAlias', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .resolves({ KeyMetadata: { KeyId: 'key-current-456' } })
      .on(UpdateAliasCommand)
      .rejects(new Error('KMSInternalException'))

    await expect(handler({ step: 'movePrevious' })).rejects.toThrow('KMSInternalException')
  })

  // --- moveCurrent step ---

  test('moveCurrent should update CURRENT alias to point to PENDING key', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PENDING' })
      .resolves({ KeyMetadata: { KeyId: 'key-pending-789' } })

    await handler({ step: 'moveCurrent' })

    const updateCalls = kmsMock.commandCalls(UpdateAliasCommand)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].args[0].input.AliasName).toBe('alias/sts/CURRENT')
    expect(updateCalls[0].args[0].input.TargetKeyId).toBe('key-pending-789')
  })

  test('moveCurrent should skip when PENDING alias does not exist', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PENDING' })
      .rejects(new NotFoundException({ message: 'not found', $metadata: {} }))

    await handler({ step: 'moveCurrent' })

    const updateCalls = kmsMock.commandCalls(UpdateAliasCommand)
    expect(updateCalls).toHaveLength(0)
  })

  // --- createPending step ---

  test('createPending should create a new RSA key and assign PENDING alias', async () => {
    kmsMock
      .on(CreateKeyCommand)
      .resolves({ KeyMetadata: { KeyId: 'new-key-abc' } })

    await handler({ step: 'createPending' })

    const createKeyCalls = kmsMock.commandCalls(CreateKeyCommand)
    expect(createKeyCalls).toHaveLength(1)
    expect(createKeyCalls[0].args[0].input.KeySpec).toBe('RSA_2048')
    expect(createKeyCalls[0].args[0].input.KeyUsage).toBe('SIGN_VERIFY')

    const updateCalls = kmsMock.commandCalls(UpdateAliasCommand)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].args[0].input.AliasName).toBe('alias/sts/PENDING')
    expect(updateCalls[0].args[0].input.TargetKeyId).toBe('new-key-abc')
  })

  test('createPending should create alias if PENDING alias does not exist yet', async () => {
    kmsMock
      .on(CreateKeyCommand)
      .resolves({ KeyMetadata: { KeyId: 'new-key-abc' } })
      .on(UpdateAliasCommand)
      .rejects(new NotFoundException({ message: 'alias not found', $metadata: {} }))

    await handler({ step: 'createPending' })

    const createAliasCalls = kmsMock.commandCalls(CreateAliasCommand)
    expect(createAliasCalls).toHaveLength(1)
    expect(createAliasCalls[0].args[0].input.AliasName).toBe('alias/sts/PENDING')
    expect(createAliasCalls[0].args[0].input.TargetKeyId).toBe('new-key-abc')
  })

  // --- invalid step ---

  test('invalid step should not call any KMS commands', async () => {
    await handler({ step: 'nonExistentStep' })

    const describeCalls = kmsMock.commandCalls(DescribeKeyCommand)
    const createKeyCalls = kmsMock.commandCalls(CreateKeyCommand)
    expect(describeCalls).toHaveLength(0)
    expect(createKeyCalls).toHaveLength(0)
  })

  // --- generateArtifacts with partial key availability ---

  test('generateArtifacts should handle missing keys gracefully (only CURRENT exists)', async () => {
    kmsMock
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PREVIOUS' })
      .rejects(new NotFoundException({ message: 'not found', $metadata: {} }))
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .resolves({ KeyMetadata: { KeyId: 'key-2' } })
      .on(DescribeKeyCommand, { KeyId: 'alias/sts/PENDING' })
      .rejects(new NotFoundException({ message: 'not found', $metadata: {} }))
      .on(GetPublicKeyCommand, { KeyId: 'alias/sts/CURRENT' })
      .resolves({ PublicKey: base64ToArrayBuffer(pubKeys.CURRENT.pem) })

    process.env.S3_BUCKET = 'test-bucket-name'
    process.env.ISSUER = 'test-issuer.com'

    await handler({ step: 'generateArtifacts' })

    // Should only have 1 key in the JWKS
    // @ts-ignore
    const s3Body = JSON.parse(s3Mock.call(0).args[0].input.Body.toString())
    expect(s3Body.keys).toHaveLength(1)
    expect(s3Body.keys[0].kid).toBe(pubKeys.CURRENT.jwk_kid)
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
