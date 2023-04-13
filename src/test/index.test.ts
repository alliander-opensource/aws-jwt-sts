// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-new */
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { AwsJwtSts } from '../index'

test('creates sts construct correctly', () => {
  const stack = new cdk.Stack()
  new AwsJwtSts(stack, 'AllianderIngress', {
    defaultAudience: 'api://default-aud'
  })

  const template = Template.fromStack(stack)
  template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
    Runtime: 'nodejs18.x'
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
