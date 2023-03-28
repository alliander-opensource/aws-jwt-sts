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
})
