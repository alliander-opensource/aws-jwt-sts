"use strict";
// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-new */
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const index_1 = require("../index");
test('creates sts construct correctly', () => {
    const stack = new cdk.Stack();
    new index_1.AwsJwtSts(stack, 'AllianderIngress', {
        defaultAudience: 'api://default-aud'
    });
    const template = assertions_1.Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', assertions_1.Match.objectLike({
        Runtime: 'nodejs18.x'
    }));
    template.hasResourceProperties('AWS::Events::Rule', assertions_1.Match.objectLike({
        EventPattern: {
            'detail-type': ['CloudFormation Stack Status Change']
        },
        State: 'ENABLED'
    }));
});
test('creates sts construct with key rotation on create/update disabled', () => {
    const stack = new cdk.Stack();
    new index_1.AwsJwtSts(stack, 'AllianderIngress', {
        defaultAudience: 'api://default-aud',
        disableKeyRotateOnCreate: true
    });
    const template = assertions_1.Template.fromStack(stack);
    template.resourcePropertiesCountIs('AWS::Events::Rule', assertions_1.Match.objectLike({
        EventPattern: {
            'detail-type': ['CloudFormation Stack Status Change']
        }
    }), 0);
});
test('creates sts construct with custom alarm names', () => {
    const stack = new cdk.Stack();
    new index_1.AwsJwtSts(stack, 'AllianderIngress', {
        defaultAudience: 'api://default-aud',
        alarmNameApiGateway5xx: 'alarm-api-gw-5xx',
        alarmNameKeyRotationLambdaFailed: 'alarm-key-rotation-lambda-failed',
        alarmNameKeyRotationStepFunctionFailed: 'alarm-step-functions-failed',
        alarmNameSignLambdaFailed: 'alarm-sign-lambda-failed'
    });
    const template = assertions_1.Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', assertions_1.Match.objectLike({
        AlarmName: 'alarm-api-gw-5xx'
    }));
    template.hasResourceProperties('AWS::CloudWatch::Alarm', assertions_1.Match.objectLike({
        AlarmName: 'alarm-key-rotation-lambda-failed'
    }));
    template.hasResourceProperties('AWS::CloudWatch::Alarm', assertions_1.Match.objectLike({
        AlarmName: 'alarm-step-functions-failed'
    }));
    template.hasResourceProperties('AWS::CloudWatch::Alarm', assertions_1.Match.objectLike({
        AlarmName: 'alarm-sign-lambda-failed'
    }));
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90ZXN0L2luZGV4LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLDRDQUE0QztBQUM1QyxFQUFFO0FBQ0Ysc0NBQXNDOztBQUV0QywyQkFBMkI7QUFDM0IsbUNBQWtDO0FBQ2xDLHVEQUF3RDtBQUN4RCxvQ0FBb0M7QUFFcEMsSUFBSSxDQUFDLGlDQUFpQyxFQUFFLEdBQUcsRUFBRTtJQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUM3QixJQUFJLGlCQUFTLENBQUMsS0FBSyxFQUFFLGtCQUFrQixFQUFFO1FBQ3ZDLGVBQWUsRUFBRSxtQkFBbUI7S0FDckMsQ0FBQyxDQUFBO0lBRUYsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDMUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHVCQUF1QixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDO1FBQ3ZFLE9BQU8sRUFBRSxZQUFZO0tBQ3RCLENBQUMsQ0FBQyxDQUFBO0lBRUgsUUFBUSxDQUFDLHFCQUFxQixDQUFDLG1CQUFtQixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUNsRTtRQUNFLFlBQVksRUFBRTtZQUNaLGFBQWEsRUFBRSxDQUFDLG9DQUFvQyxDQUFDO1NBQ3REO1FBQ0QsS0FBSyxFQUFFLFNBQVM7S0FDakIsQ0FDRixDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQTtBQUVGLElBQUksQ0FBQyxtRUFBbUUsRUFBRSxHQUFHLEVBQUU7SUFDN0UsTUFBTSxLQUFLLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDN0IsSUFBSSxpQkFBUyxDQUFDLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtRQUN2QyxlQUFlLEVBQUUsbUJBQW1CO1FBQ3BDLHdCQUF3QixFQUFFLElBQUk7S0FDL0IsQ0FBQyxDQUFBO0lBRUYsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUE7SUFFMUMsUUFBUSxDQUFDLHlCQUF5QixDQUFDLG1CQUFtQixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUN0RTtRQUNFLFlBQVksRUFBRTtZQUNaLGFBQWEsRUFBRSxDQUFDLG9DQUFvQyxDQUFDO1NBQ3REO0tBQ0YsQ0FDRixFQUFFLENBQUMsQ0FBQyxDQUFBO0FBQ1AsQ0FBQyxDQUFDLENBQUE7QUFFRixJQUFJLENBQUMsK0NBQStDLEVBQUUsR0FBRyxFQUFFO0lBQ3pELE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFBO0lBQzdCLElBQUksaUJBQVMsQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLEVBQUU7UUFDdkMsZUFBZSxFQUFFLG1CQUFtQjtRQUNwQyxzQkFBc0IsRUFBRSxrQkFBa0I7UUFDMUMsZ0NBQWdDLEVBQUUsa0NBQWtDO1FBQ3BFLHNDQUFzQyxFQUFFLDZCQUE2QjtRQUNyRSx5QkFBeUIsRUFBRSwwQkFBMEI7S0FDdEQsQ0FBQyxDQUFBO0lBRUYsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDMUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHdCQUF3QixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDO1FBQ3hFLFNBQVMsRUFBRSxrQkFBa0I7S0FDOUIsQ0FBQyxDQUFDLENBQUE7SUFDSCxRQUFRLENBQUMscUJBQXFCLENBQUMsd0JBQXdCLEVBQUUsa0JBQUssQ0FBQyxVQUFVLENBQUM7UUFDeEUsU0FBUyxFQUFFLGtDQUFrQztLQUM5QyxDQUFDLENBQUMsQ0FBQTtJQUNILFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyx3QkFBd0IsRUFBRSxrQkFBSyxDQUFDLFVBQVUsQ0FBQztRQUN4RSxTQUFTLEVBQUUsNkJBQTZCO0tBQ3pDLENBQUMsQ0FBQyxDQUFBO0lBQ0gsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHdCQUF3QixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDO1FBQ3hFLFNBQVMsRUFBRSwwQkFBMEI7S0FDdEMsQ0FBQyxDQUFDLENBQUE7QUFDTCxDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIFNQRFgtRmlsZUNvcHlyaWdodFRleHQ6IDIwMjMgQWxsaWFuZGVyIE5WXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuLyogZXNsaW50LWRpc2FibGUgbm8tbmV3ICovXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInXG5pbXBvcnQgeyBNYXRjaCwgVGVtcGxhdGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJ1xuaW1wb3J0IHsgQXdzSnd0U3RzIH0gZnJvbSAnLi4vaW5kZXgnXG5cbnRlc3QoJ2NyZWF0ZXMgc3RzIGNvbnN0cnVjdCBjb3JyZWN0bHknLCAoKSA9PiB7XG4gIGNvbnN0IHN0YWNrID0gbmV3IGNkay5TdGFjaygpXG4gIG5ldyBBd3NKd3RTdHMoc3RhY2ssICdBbGxpYW5kZXJJbmdyZXNzJywge1xuICAgIGRlZmF1bHRBdWRpZW5jZTogJ2FwaTovL2RlZmF1bHQtYXVkJ1xuICB9KVxuXG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKVxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgIFJ1bnRpbWU6ICdub2RlanMxOC54J1xuICB9KSlcblxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RXZlbnRzOjpSdWxlJywgTWF0Y2gub2JqZWN0TGlrZShcbiAgICB7XG4gICAgICBFdmVudFBhdHRlcm46IHtcbiAgICAgICAgJ2RldGFpbC10eXBlJzogWydDbG91ZEZvcm1hdGlvbiBTdGFjayBTdGF0dXMgQ2hhbmdlJ11cbiAgICAgIH0sXG4gICAgICBTdGF0ZTogJ0VOQUJMRUQnXG4gICAgfVxuICApKVxufSlcblxudGVzdCgnY3JlYXRlcyBzdHMgY29uc3RydWN0IHdpdGgga2V5IHJvdGF0aW9uIG9uIGNyZWF0ZS91cGRhdGUgZGlzYWJsZWQnLCAoKSA9PiB7XG4gIGNvbnN0IHN0YWNrID0gbmV3IGNkay5TdGFjaygpXG4gIG5ldyBBd3NKd3RTdHMoc3RhY2ssICdBbGxpYW5kZXJJbmdyZXNzJywge1xuICAgIGRlZmF1bHRBdWRpZW5jZTogJ2FwaTovL2RlZmF1bHQtYXVkJyxcbiAgICBkaXNhYmxlS2V5Um90YXRlT25DcmVhdGU6IHRydWVcbiAgfSlcblxuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaylcblxuICB0ZW1wbGF0ZS5yZXNvdXJjZVByb3BlcnRpZXNDb3VudElzKCdBV1M6OkV2ZW50czo6UnVsZScsIE1hdGNoLm9iamVjdExpa2UoXG4gICAge1xuICAgICAgRXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgICdkZXRhaWwtdHlwZSc6IFsnQ2xvdWRGb3JtYXRpb24gU3RhY2sgU3RhdHVzIENoYW5nZSddXG4gICAgICB9XG4gICAgfVxuICApLCAwKVxufSlcblxudGVzdCgnY3JlYXRlcyBzdHMgY29uc3RydWN0IHdpdGggY3VzdG9tIGFsYXJtIG5hbWVzJywgKCkgPT4ge1xuICBjb25zdCBzdGFjayA9IG5ldyBjZGsuU3RhY2soKVxuICBuZXcgQXdzSnd0U3RzKHN0YWNrLCAnQWxsaWFuZGVySW5ncmVzcycsIHtcbiAgICBkZWZhdWx0QXVkaWVuY2U6ICdhcGk6Ly9kZWZhdWx0LWF1ZCcsXG4gICAgYWxhcm1OYW1lQXBpR2F0ZXdheTV4eDogJ2FsYXJtLWFwaS1ndy01eHgnLFxuICAgIGFsYXJtTmFtZUtleVJvdGF0aW9uTGFtYmRhRmFpbGVkOiAnYWxhcm0ta2V5LXJvdGF0aW9uLWxhbWJkYS1mYWlsZWQnLFxuICAgIGFsYXJtTmFtZUtleVJvdGF0aW9uU3RlcEZ1bmN0aW9uRmFpbGVkOiAnYWxhcm0tc3RlcC1mdW5jdGlvbnMtZmFpbGVkJyxcbiAgICBhbGFybU5hbWVTaWduTGFtYmRhRmFpbGVkOiAnYWxhcm0tc2lnbi1sYW1iZGEtZmFpbGVkJ1xuICB9KVxuXG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKVxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRXYXRjaDo6QWxhcm0nLCBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICBBbGFybU5hbWU6ICdhbGFybS1hcGktZ3ctNXh4J1xuICB9KSlcbiAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJywgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgQWxhcm1OYW1lOiAnYWxhcm0ta2V5LXJvdGF0aW9uLWxhbWJkYS1mYWlsZWQnXG4gIH0pKVxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRXYXRjaDo6QWxhcm0nLCBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICBBbGFybU5hbWU6ICdhbGFybS1zdGVwLWZ1bmN0aW9ucy1mYWlsZWQnXG4gIH0pKVxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRXYXRjaDo6QWxhcm0nLCBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICBBbGFybU5hbWU6ICdhbGFybS1zaWduLWxhbWJkYS1mYWlsZWQnXG4gIH0pKVxufSlcbiJdfQ==