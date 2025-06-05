// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable max-statements, max-lines-per-function*/
import {
  aws_certificatemanager as acm,
  aws_apigateway as apigateway,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cloudfrontOrigins,
  aws_cloudwatch as cloudwatch,
  aws_events as events,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as route53targets,
  aws_s3 as s3,
  aws_stepfunctions as sfn,
  aws_sns as sns,
  aws_events_targets as targets,
  aws_stepfunctions_tasks as tasks,
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import { MethodLoggingLevel } from 'aws-cdk-lib/aws-apigateway'
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { OrganizationPrincipal, PolicyDocument } from 'aws-cdk-lib/aws-iam'
import { IHostedZone } from 'aws-cdk-lib/aws-route53'
import { BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

export enum wafUsage {
  ConstructProvided,
  ProvideWebAclArn
}

export interface AwsJwtStsProps {
  /**
   * DefaultAudience which is used in de JWT's
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
  readonly architecture?: lambda.Architecture

  /**
   * Optional boolean to specify if key rotation should be triggered on creation of the stack, default: false
   */
  readonly disableKeyRotateOnCreate?: boolean

  /**
   * Optional custom name for the CloudWatch Alarm monitoring Step Function failures, default: sts-key_rotate_sfn-alarm
   */
  readonly alarmNameKeyRotationStepFunctionFailed?: string

  /**
   * Optional custom name for the CloudWatch Alarm monitoring 5xx errors on the API Gateway, default: sts-5xx_api_gw-alarm
   */
  readonly alarmNameApiGateway5xx?: string

  /**
   * Optional custom name for the CloudWatch Alarm monitoring Sign Lambda failures, default: sts-sign_errors_lambda-alarm
   */
  readonly alarmNameSignLambdaFailed?: string

  /**
   * Optional custom name for the CloudWatch Alarm monitoring Key Rotation Lambda failures, default: sts-key_rotate_errors_lambda-alarm
   */
  readonly alarmNameKeyRotationLambdaFailed?: string

  /**
   * Current kms key name
   */
  readonly currentKeyName?: string

  /**
   * Previous kms key name
   */
  readonly previousKeyName?: string

  /**
   * Pending kms key name
   */
  readonly pendingKeyName?: string

  /**
   * Optional custom certificate for the oidc discovery, default: oidc.<hostedZoneName>
   *
   * This certificate is used for the discovery endpoint and should be in us-east-1
   */
  readonly oidcCertificate?: ICertificate;

  /**
   * Optional custom certificate for the token api, default: token.<hostedZoneName>
   *
   * This certificate is used for the token api and should be in the same region as the API Gateway
   */
  readonly tokenCertificate?: ICertificate;
}


export class AwsJwtSts extends Construct {
  /**
   * SNS topic used to publish errors from the Step Function rotation flow
   */
  public readonly failedRotationTopic: sns.Topic

  constructor (app: Construct, id: string, props: AwsJwtStsProps) {
    super(app, id)

    /** ---------------------- Custom domain thingies ----------------------- */

    let distributionDomainNames: string[] = []
    let oidcCertificate: ICertificate | undefined
    let tokenCertificate: ICertificate | undefined
    let hostedZone: IHostedZone | undefined
    const oidcSubdomain = props.oidcSubdomain ? props.oidcSubdomain : 'oidc'
    const tokenSubdomain = props.tokenSubdomain ? props.tokenSubdomain : 'token'
    const architecture = props.architecture ? props.architecture : lambda.Architecture.X86_64
    let oidcDomainName = ''
    let tokenDomainName = ''

    const useCustomDomain = props.hostedZoneId && props.hostedZoneName

    if (useCustomDomain) {
      oidcDomainName = oidcSubdomain + '.' + props.hostedZoneName
      tokenDomainName = tokenSubdomain + '.' + props.hostedZoneName

      distributionDomainNames = [oidcDomainName]

      // Can still be used for now: https://github.com/aws/aws-cdk/discussions/23931#discussioncomment-5889140
      // Feature request: https://github.com/aws/aws-cdk/issues/25343
      // Underlying cloudformation issue: https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/523
      oidcCertificate = props.oidcCertificate ?? new acm.DnsValidatedCertificate(this, 'CrossRegionCertificate', {
        domainName: oidcDomainName,
        hostedZone: route53.HostedZone.fromHostedZoneAttributes(this,'lookupHostedZone',
          {
            zoneName: props.hostedZoneName!,
            hostedZoneId: props.hostedZoneId!
          }),
        region: 'us-east-1'
      })

      tokenCertificate = props.tokenCertificate ?? new acm.Certificate(this, 'tokenCertificate', {
        domainName: tokenDomainName,
        validation: acm.CertificateValidation.fromDns(hostedZone)
      })
    }

    /** ---------------------- S3 Definition ----------------------- */

    // Create bucket where oidc information can be stored
    const oidcbucket = new s3.Bucket(this, 'oidcbucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    })

    /** ------------------- Cloudfront Definition ------------------- */

    const cloudfrontOAI = new cloudfront.OriginAccessIdentity(this, 'cloudfront-OAI', {
      comment: 'OAI for oidc'
    })

    const distribution = new cloudfront.Distribution(this, 'oidcDistribution', {
      domainNames: distributionDomainNames,
      comment: 'Discovery endpoint for OIDC',
      certificate: oidcCertificate,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(oidcbucket, { originAccessIdentity: cloudfrontOAI }),
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      }
    })

    /** ------------------ Lambda Handlers Definition ------------------ */

    const issuer = useCustomDomain ? 'https://' + oidcDomainName : 'https://' + distribution.distributionDomainName

    const rotateKeysRole = new iam.Role(this, 'rotateKeysRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    })
    const rotateKeys = new lambdaNodejs.NodejsFunction(this, 'keyrotate', {
      timeout: cdk.Duration.seconds(5),
      runtime: lambda.Runtime.NODEJS_22_X,
      role: rotateKeysRole,
      architecture,
      environment: {
        S3_BUCKET: oidcbucket.bucketName,
        ISSUER: issuer,
        CURRENT_KEY: 'alias/' + (props.currentKeyName ?? 'sts/CURRENT'),
        PREVIOUS_KEY: 'alias/' + (props.previousKeyName ?? 'sts/PREVIOUS'),
        PENDING_KEY: 'alias/' + (props.pendingKeyName ?? 'sts/PENDING')
      }
    })

    const signRole = new iam.Role(this, 'signRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    })
    const sign = new lambdaNodejs.NodejsFunction(this, 'sign', {
      timeout: cdk.Duration.seconds(5),
      runtime: lambda.Runtime.NODEJS_22_X,
      role: signRole,
      architecture,
      environment: {
        ISSUER: issuer,
        DEFAULT_AUDIENCE: props.defaultAudience,
        CURRENT_KEY: 'alias/' + (props.currentKeyName ?? 'sts/CURRENT')
      }
    })

    /** ------------------------ SNS Topic ------------------------- */

    this.failedRotationTopic = new sns.Topic(this, 'sts')
    const snsFail = new tasks.SnsPublish(this, 'snsFailed', {
      topic: this.failedRotationTopic,
      subject: 'STS KeyRotate step function execution failed',
      message: sfn.TaskInput.fromJsonPathAt('$')
    })

    /** ------------------ Step functions Definition ------------------ */

    const deletePreviousStep = new tasks.LambdaInvoke(this, 'delete Previous', {
      lambdaFunction: rotateKeys,
      payload: sfn.TaskInput.fromObject({
        step: 'deletePrevious'
      }),
      outputPath: '$.Payload'
    })

    const movePreviousStep = new tasks.LambdaInvoke(this, 'move Previous', {
      lambdaFunction: rotateKeys,
      payload: sfn.TaskInput.fromObject({
        step: 'movePrevious'
      }),
      outputPath: '$.Payload'
    })

    const moveCurrentStep = new tasks.LambdaInvoke(this, 'move Current', {
      lambdaFunction: rotateKeys,
      payload: sfn.TaskInput.fromObject({
        step: 'moveCurrent'
      }),
      outputPath: '$.Payload'
    })

    const createPendingStep = new tasks.LambdaInvoke(this, 'create Pending', {
      lambdaFunction: rotateKeys,
      payload: sfn.TaskInput.fromObject({
        step: 'createPending'
      }),
      outputPath: '$.Payload'
    })

    const generateArtifactsStep = new tasks.LambdaInvoke(this, 'generate artifacts', {
      lambdaFunction: rotateKeys,
      payload: sfn.TaskInput.fromObject({
        step: 'generateArtifacts'
      }),
      outputPath: '$.Payload'
    })

    const jobFailed = new sfn.Fail(this, 'Failed', {
      cause: 'AWS Batch Job Failed',
      error: 'DescribeJob returned FAILED'
    })

    const jobSuccess = new sfn.Succeed(this, 'Success!')

    deletePreviousStep.addCatch(snsFail)
    movePreviousStep.addCatch(snsFail)
    moveCurrentStep.addCatch(snsFail)
    createPendingStep.addCatch(snsFail)
    generateArtifactsStep.addCatch(snsFail)

    // Create chain
    const definition = deletePreviousStep
      .next(movePreviousStep)
      .next(moveCurrentStep)
      .next(createPendingStep)
      .next(generateArtifactsStep)
      .next(jobSuccess)

    snsFail.next(jobFailed)

    // Create state machine
    const rotateKeysMachine = new sfn.StateMachine(this, 'RotateKeys', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        definition
      ),
      timeout: cdk.Duration.minutes(5)
    })

    rotateKeys.grantInvoke(rotateKeysMachine.role)
    oidcbucket.grantReadWrite(rotateKeys)

    const statementSign = new iam.PolicyStatement()
    statementSign.addActions('kms:*')
    statementSign.addResources('*')
    const signPolicy = new iam.ManagedPolicy(this, 'SignPolicy', {
      statements: [statementSign]
    })
    signRole.addManagedPolicy(signPolicy)

    const statementRotateKeys = new iam.PolicyStatement()
    statementRotateKeys.addActions('kms:*')
    statementRotateKeys.addResources('*')
    const rotateKeysPolicy = new iam.ManagedPolicy(this, 'RotateKeysPolicy', {
      statements: [statementRotateKeys]
    })
    rotateKeysRole.addManagedPolicy(rotateKeysPolicy)

    /** ------------------ Events Rule Definition ------------------ */

    // Run every 3 months at 8 PM UTC
    const scheduledRotateRule = new events.Rule(this, 'scheduledRotateRule', {
      schedule: events.Schedule.expression('cron(0 20 1 */3 ? *)')
    })
    scheduledRotateRule.addTarget(new targets.SfnStateMachine(rotateKeysMachine))

    // Create state machine and trigger to populate initial keys
    if (!props.disableKeyRotateOnCreate) {
      const rotateOnce = new tasks.StepFunctionsStartExecution(this, 'rotateOnce', {
        stateMachine: rotateKeysMachine,
        integrationPattern: sfn.IntegrationPattern.RUN_JOB
      })

      const rotateTwice = new tasks.StepFunctionsStartExecution(this, 'rotateTwice', {
        stateMachine: rotateKeysMachine,
        integrationPattern: sfn.IntegrationPattern.RUN_JOB
      })

      const populateKeys = new sfn.StateMachine(this, 'populateKeys', {
        definitionBody: sfn.DefinitionBody.fromChainable(
          rotateOnce.next(rotateTwice)
        ),
        timeout: cdk.Duration.minutes(10)
      })

      const initialRunRule = new events.Rule(this, 'initialRunRule', {
        eventPattern: {
          source: ['aws.cloudformation'],
          resources: [cdk.Stack.of(this).stackId],
          detailType: ['CloudFormation Stack Status Change'],
          detail: {
            'status-details': {
              status: ['CREATE_COMPLETE']
            }
          }
        }
      })

      initialRunRule.addTarget(new targets.SfnStateMachine(populateKeys))
    }

    /** ---------------------- API Gateway ----------------------- */

    // Only set policy when orgId is set
    let apiPolicy: PolicyDocument | undefined
    if (props.orgId) {
      apiPolicy = new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            resources: ['*'],
            principals: [
              new OrganizationPrincipal(props.orgId)
            ]
          })
        ]
      })
    }

    const logGroup = new logs.LogGroup(this, 'APIGatewayAccessLogs', {
      retention: 7
    })

    // Create API
    const api = new apigateway.LambdaRestApi(this, 'jwk-sts-api', {
      description: 'STS Token API Gateway',
      handler: sign,
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
      },
      policy: apiPolicy,
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup)
      }
    })

    /** ------------------- Route53 Definition for custom domain ------------------- */

    if (useCustomDomain && hostedZone) {
      api.addDomainName('apiCustomDomainName', {
        domainName: tokenDomainName,
        certificate: tokenCertificate!
      })

      // Add A record for cloudfront distribution

      new route53.ARecord(this, 'oidcRecord', {
        recordName: oidcDomainName,
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution))
      })

      new route53.ARecord(this, 'tokenRecord', {
        recordName: tokenDomainName,
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.ApiGateway(api))
      })

      new cdk.CfnOutput(this, 'tokenEndpoint', {
        value: 'https://' + tokenDomainName + '/token',
        description: 'Url of the token endpoint',
        exportName: `${cdk.Stack.of(this)}-tokenEndpoint`
      })
    } else {
      new cdk.CfnOutput(this, 'tokenEndpoint', {
        value: api.url + 'token',
        description: 'Url of the token endpoint',
        exportName: `${cdk.Stack.of(this)}-tokenEndpoint`
      })
    }

    new cdk.CfnOutput(this, 'issuer', {
      value: issuer,
      description: 'Url of the issuer',
      exportName: `${cdk.Stack.of(this)}-issuer`
    })

    /** ---------------------- WAF ----------------------- */

    if (props.apiGwWaf === wafUsage.ConstructProvided) {
      // API gateway WAF ACL and rules
      const APIGatewayWebACL = new wafv2.CfnWebACL(this, 'APIGatewayWebACL', {
        description: 'This is WebACL for Auth APi Gateway',
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          metricName: 'APIWebACL',
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true
        },
        rules: [
          {
            name: 'AWS-AWSManagedRulesCommonRuleSet',
            priority: 0,
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet'
              }
            },
            overrideAction: {
              none: {}
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'AWS-AWSManagedRulesCommonRuleSet'
            }
          },
          {
            name: 'AWS-AWSManagedRulesAmazonIpReputationList',
            priority: 1,
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesAmazonIpReputationList'
              }
            },
            overrideAction: {
              none: {}
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'AWS-AWSManagedRulesAmazonIpReputationList'
            }
          },
          {
            name: 'api-gw-AuthAPIGeoLocation',
            priority: 3,
            action: { block: {} },
            visibilityConfig: {
              metricName: 'AuthAPIGeoLocation',
              cloudWatchMetricsEnabled: true,
              sampledRequestsEnabled: false
            },
            statement: {
              geoMatchStatement: {
                countryCodes: ['BY', 'CN', 'IR', 'RU', 'SY', 'KP']
              }
            }
          },
          {
            name: 'api-gw-rateLimitRule',
            priority: 4,
            action: { block: {} },
            visibilityConfig: {
              metricName: 'rateLimitRule',
              cloudWatchMetricsEnabled: true,
              sampledRequestsEnabled: false
            },
            statement: {
              rateBasedStatement: {
                aggregateKeyType: 'IP',
                limit: 100
              }
            }
          }
        ]
      })

      // Web ACL Association
      new wafv2.CfnWebACLAssociation(this, 'APIGatewayWebACLAssociation', {
        webAclArn: APIGatewayWebACL.attrArn,
        resourceArn: api.deploymentStage.stageArn
      })
    } else if (props.apiGwWaf === wafUsage.ProvideWebAclArn && props.apiGwWafWebAclArn) {
      // Web ACL Association
      new wafv2.CfnWebACLAssociation(this, 'APIGatewayWebACLAssociation', {
        webAclArn: props.apiGwWafWebAclArn,
        resourceArn: api.deploymentStage.stageArn
      })
    }

    /** ---------------------- Cloudwatch ----------------------- */

    new cloudwatch.Alarm(this, 'StepFunctionError', {
      alarmName: props.alarmNameKeyRotationStepFunctionFailed ?? 'sts-key_rotate_sfn-alarm',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      metric: rotateKeysMachine.metricFailed(),
      alarmDescription: 'Key Rotation Failed',
      treatMissingData: TreatMissingData.NOT_BREACHING
    })

    new cloudwatch.Alarm(this, 'ApiGateway5XXAlarm', {
      alarmName: props.alarmNameApiGateway5xx ?? 'sts-5xx_api_gw-alarm',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      metric: api.metricServerError(),
      alarmDescription: '5xx STS API gateway failures',
      treatMissingData: TreatMissingData.NOT_BREACHING
    })

    const signErrors = sign.metricErrors({
      period: cdk.Duration.minutes(1)
    })

    const rotateErrors = rotateKeys.metricErrors({
      period: cdk.Duration.minutes(1)
    })

    new cloudwatch.Alarm(this, 'LambdaSignError', {
      alarmName: props.alarmNameSignLambdaFailed ?? 'sts-sign_errors_lambda-alarm',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      metric: signErrors,
      alarmDescription: 'Sign Lambda Failed',
      treatMissingData: TreatMissingData.NOT_BREACHING
    })

    new cloudwatch.Alarm(this, 'LambdaRotateError', {
      alarmName: props.alarmNameKeyRotationLambdaFailed ?? 'sts-key_rotate_errors_lambda-alarm',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      metric: rotateErrors,
      alarmDescription: 'Key Rotation Lambda Failed',
      treatMissingData: TreatMissingData.NOT_BREACHING
    })
  }
}
