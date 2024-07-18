import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
export declare enum wafUsage {
    ConstructProvided = 0,
    ProvideWebAclArn = 1
}
export interface AwsJwtStsProps {
    /**
     * defaultAudience which is used in de JWT's
     */
    readonly defaultAudience: string;
    /**
     * HostedZoneId of the domain used for hosting the sts function
     */
    readonly hostedZoneId?: string;
    /**
     * Name of the hostedZone.
     */
    readonly hostedZoneName?: string;
    /**
    * Optional subdomain name of oidc discovery, default: oidc.
    */
    readonly oidcSubdomain?: string;
    /**
    * Optional subdomain name of the token api (on api gw), default: token.
    */
    readonly tokenSubdomain?: string;
    /**
     * If waf needs to be added to the API GW
     *
     * None: no waf is used
     * ConstructProvided: the construct will deploy a wafAcl with opinionated rules
     * ProvideWebAclArn: provide your own arn
     */
    readonly apiGwWaf?: wafUsage;
    /**
     * Arn of the waf webAcl rule to be associated with the API GW
     *
     */
    readonly apiGwWafWebAclArn?: string;
    /**
     * The ID of the AWS Organization 0-xxxx
     *
     */
    readonly orgId?: string;
    /**
     * CPU Architecture
     */
    readonly architecture?: lambda.Architecture;
    /**
     * Optional boolean to specify if key rotation should be triggered on creation of the stack, default: false
     */
    readonly disableKeyRotateOnCreate?: boolean;
    /**
     * Optional custom name for the CloudWatch Alarm monitoring Step Function failures, default: sts-key_rotate_sfn-alarm
     */
    readonly alarmNameKeyRotationStepFunctionFailed?: string;
    /**
     * Optional custom name for the CloudWatch Alarm monitoring 5xx errors on the API Gateway, default: sts-5xx_api_gw-alarm
     */
    readonly alarmNameApiGateway5xx?: string;
    /**
     * Optional custom name for the CloudWatch Alarm monitoring Sign Lambda failures, default: sts-sign_errors_lambda-alarm
     */
    readonly alarmNameSignLambdaFailed?: string;
    /**
     * Optional custom name for the CloudWatch Alarm monitoring Key Rotation Lambda failures, default: sts-key_rotate_errors_lambda-alarm
     */
    readonly alarmNameKeyRotationLambdaFailed?: string;
    /**
     * current kms key name
     */
    readonly currentKeyName?: string;
    /**
     * previous kms key name
     */
    readonly previousKeyName?: string;
    /**
     * pending kms key name
     */
    readonly pendingKeyName?: string;
}
export declare class AwsJwtSts extends Construct {
    /**
     * SNS topic used to publish errors from the Step Function rotation flow
     */
    readonly failedRotationTopic: sns.Topic;
    constructor(app: Construct, id: string, props: AwsJwtStsProps);
}
