// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0


import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'

/* eslint-disable-next-line import/no-unresolved */
import { AwsJwtSts } from '../index'

test('creates sts construct correctly', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'AllianderIngress', {
    defaultAudience: 'api://default-aud'
  })

  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
    Runtime: 'nodejs22.x'
  }))

  template.hasResourceProperties('AWS::Events::Rule', Match.objectLike(
    {
      EventPattern: {
        'detail-type': ['CloudFormation Stack Status Change']
      },
      State: 'ENABLED'
    }
  ))
})

test('creates sts construct with key rotation on create/update disabled', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'AllianderIngress', {
    defaultAudience: 'api://default-aud',
    disableKeyRotateOnCreate: true
  })

  const template = Template.fromStack(stack)

  template.resourcePropertiesCountIs('AWS::Events::Rule', Match.objectLike(
    {
      EventPattern: {
        'detail-type': ['CloudFormation Stack Status Change']
      }
    }
  ), 0)
})

test('creates sts construct with custom alarm names', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'AllianderIngress', {
    defaultAudience: 'api://default-aud',
    alarmNameApiGateway5xx: 'alarm-api-gw-5xx',
    alarmNameKeyRotationLambdaFailed: 'alarm-key-rotation-lambda-failed',
    alarmNameKeyRotationStepFunctionFailed: 'alarm-step-functions-failed',
    alarmNameSignLambdaFailed: 'alarm-sign-lambda-failed'
  })

  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'alarm-api-gw-5xx'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'alarm-key-rotation-lambda-failed'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'alarm-step-functions-failed'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'alarm-sign-lambda-failed'
  }))
})

test('creates sts construct with custom domain name', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithCustomDomain', {
    defaultAudience: 'api://default-aud',
    hostedZoneId: 'test-zone-id',
    hostedZoneName: 'test-zone-name',
    oidcSubdomain: 'test-oidc',
    tokenSubdomain: 'test-token',
  })

  const template = Template.fromStack(stack)
  template.resourceCountIs('AWS::Route53::RecordSet',2) // One for OIDC and one for Token
  template.resourceCountIs('AWS::ApiGateway::BasePathMapping', 1) // sts API Gateway mapping

})

test('creates sts construct with orgId and policy', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithOrgId', {
    defaultAudience: 'api://default-aud',
    orgId: 'o-1234567890'
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::IAM::Policy', Match.anyValue())
})

test('creates sts construct with WAF provided by construct', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithWaf', {
    defaultAudience: 'api://default-aud',
    apiGwWaf: 0 // WafUsage.CONSTRUCT_PROVIDED
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::WAFv2::WebACL', Match.anyValue())
  template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', Match.anyValue())
})

test('creates sts construct with WAF using provided ARN', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithWafArn', {
    defaultAudience: 'api://default-aud',
    apiGwWaf: 1, // WafUsage.PROVIDE_WEB_ACL_ARN
    apiGwWafWebAclArn: 'arn:aws:wafv2:region:account-id:global/webacl/name/id'
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', Match.objectLike({
    WebACLArn: 'arn:aws:wafv2:region:account-id:global/webacl/name/id'
  }))
})

test('creates sts construct with all custom key names', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithCustomKeys', {
    defaultAudience: 'api://default-aud',
    currentKeyName: 'custom-current',
    previousKeyName: 'custom-previous',
    pendingKeyName: 'custom-pending',
  })
  const template = Template.fromStack(stack)
  //add assertions for the custom key names
  template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
    Environment: {
      Variables: {
        CURRENT_KEY: 'alias/custom-current',
        PREVIOUS_KEY: 'alias/custom-previous',
        PENDING_KEY: 'alias/custom-pending'
      }
    }
  }))
})

test('creates sts construct with custom certificates', () => {
  const stack = new cdk.Stack()
  // Mock import existing certificates using CDK's proper method
  const oidcCert = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
    stack,
    'ImportedOidcCert',
    'arn:aws:acm:us-east-1:account:certificate/oidc-123'
  )
  const tokenCert = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
    stack,
    'ImportedTokenCert',
    'arn:aws:acm:us-east-1:account:certificate/token-123'
  )
  new AwsJwtSts(stack, 'WithCerts', {
    defaultAudience: 'api://default-aud',
    hostedZoneId: 'zone-id',
    hostedZoneName: 'zone.name',
    oidcCertificate: oidcCert,
    tokenCertificate: tokenCert
  })
  const template = Template.fromStack(stack)
  template.resourceCountIs('AWS::CertificateManager::Certificate', 0)
})

test('creates sts construct with all custom alarm names and disables key rotation on create', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'AllCustomAlarms', {
    defaultAudience: 'api://default-aud',
    alarmNameApiGateway5xx: 'api5xx',
    alarmNameKeyRotationLambdaFailed: 'keyrotatelambda',
    alarmNameKeyRotationStepFunctionFailed: 'keyrotatesfn',
    alarmNameSignLambdaFailed: 'signlambda',
    disableKeyRotateOnCreate: true
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'api5xx'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'keyrotatelambda'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'keyrotatesfn'
  }))
  template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
    AlarmName: 'signlambda'
  }))
})

test('can create the lambdas with a different architecture', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithArmLambdas', {
    defaultAudience: 'api://default-aud',
    architecture: cdk.aws_lambda.Architecture.ARM_64
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
    Architectures: [cdk.aws_lambda.Architecture.ARM_64.toString()]
  }))
})

test('creates sts construct with custom api name', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithCustomApiName', {
    defaultAudience: 'api://default-aud',
    jwkApiName: 'custom-api-name'
  })

  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::ApiGateway::RestApi', Match.objectLike({
    Name: 'custom-api-name'
  }))
})

test('creates sts construct with default api name', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'WithDefaultApiName', {
    defaultAudience: 'api://default-aud'
  })

  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::ApiGateway::RestApi', Match.objectLike({
    Name: 'jwk-sts-api'
  }))
})