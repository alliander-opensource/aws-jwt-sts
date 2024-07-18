"use strict";
// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsJwtSts = exports.wafUsage = void 0;
/* eslint-disable no-unused-vars */
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const sfn = require("aws-cdk-lib/aws-stepfunctions");
const tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const iam = require("aws-cdk-lib/aws-iam");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const s3 = require("aws-cdk-lib/aws-s3");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const cloudfrontOrigins = require("aws-cdk-lib/aws-cloudfront-origins");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const route53 = require("aws-cdk-lib/aws-route53");
const route53targets = require("aws-cdk-lib/aws-route53-targets");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const wafv2 = require("aws-cdk-lib/aws-wafv2");
const sns = require("aws-cdk-lib/aws-sns");
const logs = require("aws-cdk-lib/aws-logs");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const aws_cloudwatch_1 = require("aws-cdk-lib/aws-cloudwatch");
const lambdaNodejs = require("aws-cdk-lib/aws-lambda-nodejs");
const constructs_1 = require("constructs");
var wafUsage;
(function (wafUsage) {
    wafUsage[wafUsage["ConstructProvided"] = 0] = "ConstructProvided";
    wafUsage[wafUsage["ProvideWebAclArn"] = 1] = "ProvideWebAclArn";
})(wafUsage || (exports.wafUsage = wafUsage = {}));
/* eslint-disable no-new */
class AwsJwtSts extends constructs_1.Construct {
    constructor(app, id, props) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        super(app, id);
        /** ---------------------- Custom domain thingies ----------------------- */
        let distributionDomainNames = [];
        let oidcCertificate;
        let tokenCertificate;
        let hostedZone;
        const oidcSubdomain = props.oidcSubdomain ? props.oidcSubdomain : 'oidc';
        const tokenSubdomain = props.tokenSubdomain ? props.tokenSubdomain : 'token';
        const architecture = props.architecture ? props.architecture : lambda.Architecture.X86_64;
        let oidcDomainName = '';
        let tokenDomainName = '';
        const useCustomDomain = props.hostedZoneId && props.hostedZoneName;
        if (useCustomDomain) {
            oidcDomainName = oidcSubdomain + '.' + props.hostedZoneName;
            tokenDomainName = tokenSubdomain + '.' + props.hostedZoneName;
            distributionDomainNames = [oidcDomainName];
            hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'hostedZone', {
                zoneName: props.hostedZoneName,
                hostedZoneId: props.hostedZoneId
            });
            oidcCertificate = new acm.DnsValidatedCertificate(this, 'CrossRegionCertificate', {
                domainName: oidcDomainName,
                hostedZone,
                region: 'us-east-1'
            });
            tokenCertificate = new acm.Certificate(this, 'tokenCertificate', {
                domainName: tokenDomainName,
                validation: acm.CertificateValidation.fromDns(hostedZone)
            });
        }
        /** ---------------------- S3 Definition ----------------------- */
        // Create bucket where oidc information can be stored
        const oidcbucket = new s3.Bucket(this, 'oidcbucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            encryption: aws_s3_1.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
        });
        /** ------------------- Cloudfront Definition ------------------- */
        const cloudfrontOAI = new cloudfront.OriginAccessIdentity(this, 'cloudfront-OAI', {
            comment: 'OAI for oidc'
        });
        const distribution = new cloudfront.Distribution(this, 'oidcDistribution', {
            domainNames: distributionDomainNames,
            comment: 'Discovery endpoint for OIDC',
            certificate: oidcCertificate,
            defaultBehavior: {
                origin: new cloudfrontOrigins.S3Origin(oidcbucket, { originAccessIdentity: cloudfrontOAI }),
                compress: true,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
            }
        });
        /** ------------------ Lambda Handlers Definition ------------------ */
        const issuer = useCustomDomain ? 'https://' + oidcDomainName : 'https://' + distribution.distributionDomainName;
        const rotateKeysRole = new iam.Role(this, 'rotateKeysRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
        });
        const rotateKeys = new lambdaNodejs.NodejsFunction(this, 'keyrotate', {
            timeout: cdk.Duration.seconds(5),
            runtime: lambda.Runtime.NODEJS_18_X,
            role: rotateKeysRole,
            architecture,
            environment: {
                S3_BUCKET: oidcbucket.bucketName,
                ISSUER: issuer,
                CURRENT_KEY: (_a = props.currentKeyName) !== null && _a !== void 0 ? _a : 'sts/CURRENT',
                PREVIOUS_KEY: (_b = props.previousKeyName) !== null && _b !== void 0 ? _b : 'sts/PREVIOUS',
                PENDING_KEY: (_c = props.pendingKeyName) !== null && _c !== void 0 ? _c : 'sts/PENDING'
            }
        });
        const signRole = new iam.Role(this, 'signRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
        });
        const sign = new lambdaNodejs.NodejsFunction(this, 'sign', {
            timeout: cdk.Duration.seconds(5),
            runtime: lambda.Runtime.NODEJS_18_X,
            role: signRole,
            architecture,
            environment: {
                ISSUER: issuer,
                DEFAULT_AUDIENCE: props.defaultAudience,
                CURRENT_KEY: (_d = props.currentKeyName) !== null && _d !== void 0 ? _d : 'sts/CURRENT'
            }
        });
        /** ------------------------ SNS Topic ------------------------- */
        this.failedRotationTopic = new sns.Topic(this, 'sts');
        const snsFail = new tasks.SnsPublish(this, 'snsFailed', {
            topic: this.failedRotationTopic,
            subject: 'STS KeyRotate step function execution failed',
            message: sfn.TaskInput.fromJsonPathAt('$')
        });
        /** ------------------ Step functions Definition ------------------ */
        const deletePreviousStep = new tasks.LambdaInvoke(this, 'delete Previous', {
            lambdaFunction: rotateKeys,
            payload: sfn.TaskInput.fromObject({
                step: 'deletePrevious'
            }),
            outputPath: '$.Payload'
        });
        const movePreviousStep = new tasks.LambdaInvoke(this, 'move Previous', {
            lambdaFunction: rotateKeys,
            payload: sfn.TaskInput.fromObject({
                step: 'movePrevious'
            }),
            outputPath: '$.Payload'
        });
        const moveCurrentStep = new tasks.LambdaInvoke(this, 'move Current', {
            lambdaFunction: rotateKeys,
            payload: sfn.TaskInput.fromObject({
                step: 'moveCurrent'
            }),
            outputPath: '$.Payload'
        });
        const createPendingStep = new tasks.LambdaInvoke(this, 'create Pending', {
            lambdaFunction: rotateKeys,
            payload: sfn.TaskInput.fromObject({
                step: 'createPending'
            }),
            outputPath: '$.Payload'
        });
        const generateArtifactsStep = new tasks.LambdaInvoke(this, 'generate artifacts', {
            lambdaFunction: rotateKeys,
            payload: sfn.TaskInput.fromObject({
                step: 'generateArtifacts'
            }),
            outputPath: '$.Payload'
        });
        const jobFailed = new sfn.Fail(this, 'Failed', {
            cause: 'AWS Batch Job Failed',
            error: 'DescribeJob returned FAILED'
        });
        const jobSuccess = new sfn.Succeed(this, 'Success!');
        deletePreviousStep.addCatch(snsFail);
        movePreviousStep.addCatch(snsFail);
        moveCurrentStep.addCatch(snsFail);
        createPendingStep.addCatch(snsFail);
        generateArtifactsStep.addCatch(snsFail);
        // Create chain
        const definition = deletePreviousStep
            .next(movePreviousStep)
            .next(moveCurrentStep)
            .next(createPendingStep)
            .next(generateArtifactsStep)
            .next(jobSuccess);
        snsFail.next(jobFailed);
        // Create state machine
        const rotateKeysMachine = new sfn.StateMachine(this, 'RotateKeys', {
            definitionBody: sfn.DefinitionBody.fromChainable(definition),
            timeout: cdk.Duration.minutes(5)
        });
        rotateKeys.grantInvoke(rotateKeysMachine.role);
        oidcbucket.grantReadWrite(rotateKeys);
        const statementSign = new iam.PolicyStatement();
        statementSign.addActions('kms:*');
        statementSign.addResources('*');
        const signPolicy = new iam.ManagedPolicy(this, 'SignPolicy', {
            statements: [statementSign]
        });
        signRole.addManagedPolicy(signPolicy);
        const statementRotateKeys = new iam.PolicyStatement();
        statementRotateKeys.addActions('kms:*');
        statementRotateKeys.addResources('*');
        const rotateKeysPolicy = new iam.ManagedPolicy(this, 'RotateKeysPolicy', {
            statements: [statementRotateKeys]
        });
        rotateKeysRole.addManagedPolicy(rotateKeysPolicy);
        /** ------------------ Events Rule Definition ------------------ */
        // Run every 3 months at 8 PM UTC
        const scheduledRotateRule = new events.Rule(this, 'scheduledRotateRule', {
            schedule: events.Schedule.expression('cron(0 20 1 */3 ? *)')
        });
        scheduledRotateRule.addTarget(new targets.SfnStateMachine(rotateKeysMachine));
        // Create state machine and trigger to populate initial keys
        if (!props.disableKeyRotateOnCreate) {
            const rotateOnce = new tasks.StepFunctionsStartExecution(this, 'rotateOnce', {
                stateMachine: rotateKeysMachine,
                integrationPattern: sfn.IntegrationPattern.RUN_JOB
            });
            const rotateTwice = new tasks.StepFunctionsStartExecution(this, 'rotateTwice', {
                stateMachine: rotateKeysMachine,
                integrationPattern: sfn.IntegrationPattern.RUN_JOB
            });
            const populateKeys = new sfn.StateMachine(this, 'populateKeys', {
                definitionBody: sfn.DefinitionBody.fromChainable(rotateOnce.next(rotateTwice)),
                timeout: cdk.Duration.minutes(10)
            });
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
            });
            initialRunRule.addTarget(new targets.SfnStateMachine(populateKeys));
        }
        /** ---------------------- API Gateway ----------------------- */
        // only set policy when orgId is set
        let apiPolicy;
        if (props.orgId) {
            apiPolicy = new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        actions: ['execute-api:Invoke'],
                        resources: ['*'],
                        principals: [
                            new aws_iam_1.OrganizationPrincipal(props.orgId)
                        ]
                    })
                ]
            });
        }
        const logGroup = new logs.LogGroup(this, 'APIGatewayAccessLogs', {
            retention: 7
        });
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
                loggingLevel: aws_apigateway_1.MethodLoggingLevel.INFO,
                accessLogDestination: new apigateway.LogGroupLogDestination(logGroup)
            }
        });
        /** ------------------- Route53 Definition for custom domain ------------------- */
        if (useCustomDomain && hostedZone) {
            api.addDomainName('apiCustomDomainName', {
                domainName: tokenDomainName,
                certificate: tokenCertificate
            });
            // Add A record for cloudfront distribution
            new route53.ARecord(this, 'oidcRecord', {
                recordName: oidcDomainName,
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution))
            });
            new route53.ARecord(this, 'tokenRecord', {
                recordName: tokenDomainName,
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(new route53targets.ApiGateway(api))
            });
            new cdk.CfnOutput(this, 'tokenEndpoint', {
                value: 'https://' + tokenDomainName + '/token',
                description: 'Url of the token endpoint',
                exportName: `${cdk.Stack.of(this)}-tokenEndpoint`
            });
        }
        else {
            new cdk.CfnOutput(this, 'tokenEndpoint', {
                value: api.url + 'token',
                description: 'Url of the token endpoint',
                exportName: `${cdk.Stack.of(this)}-tokenEndpoint`
            });
        }
        new cdk.CfnOutput(this, 'issuer', {
            value: issuer,
            description: 'Url of the issuer',
            exportName: `${cdk.Stack.of(this)}-issuer`
        });
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
            });
            // Web ACL Association
            new wafv2.CfnWebACLAssociation(this, 'APIGatewayWebACLAssociation', {
                webAclArn: APIGatewayWebACL.attrArn,
                resourceArn: api.deploymentStage.stageArn
            });
        }
        else if (props.apiGwWaf === wafUsage.ProvideWebAclArn && props.apiGwWafWebAclArn) {
            // Web ACL Association
            new wafv2.CfnWebACLAssociation(this, 'APIGatewayWebACLAssociation', {
                webAclArn: props.apiGwWafWebAclArn,
                resourceArn: api.deploymentStage.stageArn
            });
        }
        /** ---------------------- Cloudwatch ----------------------- */
        new cloudwatch.Alarm(this, 'StepFunctionError', {
            alarmName: (_e = props.alarmNameKeyRotationStepFunctionFailed) !== null && _e !== void 0 ? _e : 'sts-key_rotate_sfn-alarm',
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 1,
            metric: rotateKeysMachine.metricFailed(),
            alarmDescription: 'Key Rotation Failed',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING
        });
        new cloudwatch.Alarm(this, 'ApiGateway5XXAlarm', {
            alarmName: (_f = props.alarmNameApiGateway5xx) !== null && _f !== void 0 ? _f : 'sts-5xx_api_gw-alarm',
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 1,
            metric: api.metricServerError(),
            alarmDescription: '5xx STS API gateway failures',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING
        });
        const signErrors = sign.metricErrors({
            period: cdk.Duration.minutes(1)
        });
        const rotateErrors = rotateKeys.metricErrors({
            period: cdk.Duration.minutes(1)
        });
        new cloudwatch.Alarm(this, 'LambdaSignError', {
            alarmName: (_g = props.alarmNameSignLambdaFailed) !== null && _g !== void 0 ? _g : 'sts-sign_errors_lambda-alarm',
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 1,
            metric: signErrors,
            alarmDescription: 'Sign Lambda Failed',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING
        });
        new cloudwatch.Alarm(this, 'LambdaRotateError', {
            alarmName: (_h = props.alarmNameKeyRotationLambdaFailed) !== null && _h !== void 0 ? _h : 'sts-key_rotate_errors_lambda-alarm',
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 1,
            metric: rotateErrors,
            alarmDescription: 'Key Rotation Lambda Failed',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING
        });
    }
}
exports.AwsJwtSts = AwsJwtSts;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLDRDQUE0QztBQUM1QyxFQUFFO0FBQ0Ysc0NBQXNDOzs7QUFFdEMsbUNBQW1DO0FBQ25DLG1DQUFrQztBQUNsQyxpREFBZ0Q7QUFDaEQscURBQW9EO0FBQ3BELDZEQUE0RDtBQUM1RCwyQ0FBMEM7QUFDMUMsaURBQTJFO0FBQzNFLHlDQUF3QztBQUN4QywrQ0FBcUQ7QUFDckQseURBQXdEO0FBQ3hELHdFQUF1RTtBQUN2RSxpREFBZ0Q7QUFDaEQsMERBQXlEO0FBQ3pELDBEQUF5RDtBQUN6RCxtREFBa0Q7QUFDbEQsa0VBQWlFO0FBQ2pFLHlEQUF3RDtBQUN4RCwrREFBK0Q7QUFDL0QsK0NBQThDO0FBQzlDLDJDQUEwQztBQUMxQyw2Q0FBNEM7QUFDNUMseURBQXdEO0FBQ3hELCtEQUE2RDtBQUM3RCw4REFBNkQ7QUFDN0QsMkNBQXNDO0FBSXRDLElBQVksUUFHWDtBQUhELFdBQVksUUFBUTtJQUNsQixpRUFBaUIsQ0FBQTtJQUNqQiwrREFBZ0IsQ0FBQTtBQUNsQixDQUFDLEVBSFcsUUFBUSx3QkFBUixRQUFRLFFBR25CO0FBK0ZELDJCQUEyQjtBQUMzQixNQUFhLFNBQVUsU0FBUSxzQkFBUztJQU10QyxZQUFhLEdBQWMsRUFBRSxFQUFVLEVBQUUsS0FBcUI7O1FBQzVELEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFZCw0RUFBNEU7UUFFNUUsSUFBSSx1QkFBdUIsR0FBYSxFQUFFLENBQUE7UUFDMUMsSUFBSSxlQUF5QyxDQUFBO1FBQzdDLElBQUksZ0JBQTBDLENBQUE7UUFDOUMsSUFBSSxVQUFtQyxDQUFBO1FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQTtRQUN4RSxNQUFN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XG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuLyogZXNsaW50LWRpc2FibGUgbm8tdW51c2VkLXZhcnMgKi9cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJ1xuaW1wb3J0ICogYXMgc2ZuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJ1xuaW1wb3J0ICogYXMgdGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCB7IE9yZ2FuaXphdGlvblByaW5jaXBhbCwgUG9saWN5RG9jdW1lbnQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0IHsgQnVja2V0RW5jcnlwdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMydcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnXG5pbXBvcnQgKiBhcyBjbG91ZGZyb250T3JpZ2lucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJ1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnXG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cydcbmltcG9ydCAqIGFzIGFjbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyJ1xuaW1wb3J0ICogYXMgcm91dGU1MyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtcm91dGU1MydcbmltcG9ydCAqIGFzIHJvdXRlNTN0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzLXRhcmdldHMnXG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5J1xuaW1wb3J0IHsgTWV0aG9kTG9nZ2luZ0xldmVsIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknXG5pbXBvcnQgKiBhcyB3YWZ2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtd2FmdjInXG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucydcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnXG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJ1xuaW1wb3J0IHsgVHJlYXRNaXNzaW5nRGF0YSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJ1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJ1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcbmltcG9ydCB7IElDZXJ0aWZpY2F0ZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInXG5pbXBvcnQgeyBJSG9zdGVkWm9uZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJ1xuXG5leHBvcnQgZW51bSB3YWZVc2FnZSB7XG4gIENvbnN0cnVjdFByb3ZpZGVkLFxuICBQcm92aWRlV2ViQWNsQXJuXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXdzSnd0U3RzUHJvcHMge1xuICAvKipcbiAgICogZGVmYXVsdEF1ZGllbmNlIHdoaWNoIGlzIHVzZWQgaW4gZGUgSldUJ3NcbiAgICovXG4gIHJlYWRvbmx5IGRlZmF1bHRBdWRpZW5jZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBIb3N0ZWRab25lSWQgb2YgdGhlIGRvbWFpbiB1c2VkIGZvciBob3N0aW5nIHRoZSBzdHMgZnVuY3Rpb25cbiAgICovXG4gIHJlYWRvbmx5IGhvc3RlZFpvbmVJZD86IHN0cmluZztcblxuICAvKipcbiAgICogTmFtZSBvZiB0aGUgaG9zdGVkWm9uZS5cbiAgICovXG4gIHJlYWRvbmx5IGhvc3RlZFpvbmVOYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAqIE9wdGlvbmFsIHN1YmRvbWFpbiBuYW1lIG9mIG9pZGMgZGlzY292ZXJ5LCBkZWZhdWx0OiBvaWRjLlxuICAqL1xuICByZWFkb25seSBvaWRjU3ViZG9tYWluPzogc3RyaW5nO1xuXG4gIC8qKlxuICAqIE9wdGlvbmFsIHN1YmRvbWFpbiBuYW1lIG9mIHRoZSB0b2tlbiBhcGkgKG9uIGFwaSBndyksIGRlZmF1bHQ6IHRva2VuLlxuICAqL1xuICByZWFkb25seSB0b2tlblN1YmRvbWFpbj86IHN0cmluZztcblxuICAvKipcbiAgICogSWYgd2FmIG5lZWRzIHRvIGJlIGFkZGVkIHRvIHRoZSBBUEkgR1dcbiAgICpcbiAgICogTm9uZTogbm8gd2FmIGlzIHVzZWRcbiAgICogQ29uc3RydWN0UHJvdmlkZWQ6IHRoZSBjb25zdHJ1Y3Qgd2lsbCBkZXBsb3kgYSB3YWZBY2wgd2l0aCBvcGluaW9uYXRlZCBydWxlc1xuICAgKiBQcm92aWRlV2ViQWNsQXJuOiBwcm92aWRlIHlvdXIgb3duIGFyblxuICAgKi9cbiAgcmVhZG9ubHkgYXBpR3dXYWY/OiB3YWZVc2FnZTtcblxuICAvKipcbiAgICogQXJuIG9mIHRoZSB3YWYgd2ViQWNsIHJ1bGUgdG8gYmUgYXNzb2NpYXRlZCB3aXRoIHRoZSBBUEkgR1dcbiAgICpcbiAgICovXG4gIHJlYWRvbmx5IGFwaUd3V2FmV2ViQWNsQXJuPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgSUQgb2YgdGhlIEFXUyBPcmdhbml6YXRpb24gMC14eHh4XG4gICAqXG4gICAqL1xuICByZWFkb25seSBvcmdJZD86IHN0cmluZztcblxuICAvKipcbiAgICogQ1BVIEFyY2hpdGVjdHVyZVxuICAgKi9cbiAgcmVhZG9ubHkgYXJjaGl0ZWN0dXJlPzogbGFtYmRhLkFyY2hpdGVjdHVyZVxuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBib29sZWFuIHRvIHNwZWNpZnkgaWYga2V5IHJvdGF0aW9uIHNob3VsZCBiZSB0cmlnZ2VyZWQgb24gY3JlYXRpb24gb2YgdGhlIHN0YWNrLCBkZWZhdWx0OiBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgZGlzYWJsZUtleVJvdGF0ZU9uQ3JlYXRlPzogYm9vbGVhblxuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBjdXN0b20gbmFtZSBmb3IgdGhlIENsb3VkV2F0Y2ggQWxhcm0gbW9uaXRvcmluZyBTdGVwIEZ1bmN0aW9uIGZhaWx1cmVzLCBkZWZhdWx0OiBzdHMta2V5X3JvdGF0ZV9zZm4tYWxhcm1cbiAgICovXG4gIHJlYWRvbmx5IGFsYXJtTmFtZUtleVJvdGF0aW9uU3RlcEZ1bmN0aW9uRmFpbGVkPzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGN1c3RvbSBuYW1lIGZvciB0aGUgQ2xvdWRXYXRjaCBBbGFybSBtb25pdG9yaW5nIDV4eCBlcnJvcnMgb24gdGhlIEFQSSBHYXRld2F5LCBkZWZhdWx0OiBzdHMtNXh4X2FwaV9ndy1hbGFybVxuICAgKi9cbiAgcmVhZG9ubHkgYWxhcm1OYW1lQXBpR2F0ZXdheTV4eD86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBjdXN0b20gbmFtZSBmb3IgdGhlIENsb3VkV2F0Y2ggQWxhcm0gbW9uaXRvcmluZyBTaWduIExhbWJkYSBmYWlsdXJlcywgZGVmYXVsdDogc3RzLXNpZ25fZXJyb3JzX2xhbWJkYS1hbGFybVxuICAgKi9cbiAgcmVhZG9ubHkgYWxhcm1OYW1lU2lnbkxhbWJkYUZhaWxlZD86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBjdXN0b20gbmFtZSBmb3IgdGhlIENsb3VkV2F0Y2ggQWxhcm0gbW9uaXRvcmluZyBLZXkgUm90YXRpb24gTGFtYmRhIGZhaWx1cmVzLCBkZWZhdWx0OiBzdHMta2V5X3JvdGF0ZV9lcnJvcnNfbGFtYmRhLWFsYXJtXG4gICAqL1xuICByZWFkb25seSBhbGFybU5hbWVLZXlSb3RhdGlvbkxhbWJkYUZhaWxlZD86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBjdXJyZW50IGttcyBrZXkgbmFtZVxuICAgKi9cbiAgcmVhZG9ubHkgY3VycmVudEtleU5hbWU/OiBzdHJpbmdcblxuICAvKipcbiAgICogcHJldmlvdXMga21zIGtleSBuYW1lXG4gICAqL1xuICByZWFkb25seSBwcmV2aW91c0tleU5hbWU/OiBzdHJpbmdcblxuICAvKipcbiAgICogcGVuZGluZyBrbXMga2V5IG5hbWVcbiAgICovXG4gIHJlYWRvbmx5IHBlbmRpbmdLZXlOYW1lPzogc3RyaW5nXG59XG5cbi8qIGVzbGludC1kaXNhYmxlIG5vLW5ldyAqL1xuZXhwb3J0IGNsYXNzIEF3c0p3dFN0cyBleHRlbmRzIENvbnN0cnVjdCB7XG4gIC8qKlxuICAgKiBTTlMgdG9waWMgdXNlZCB0byBwdWJsaXNoIGVycm9ycyBmcm9tIHRoZSBTdGVwIEZ1bmN0aW9uIHJvdGF0aW9uIGZsb3dcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBmYWlsZWRSb3RhdGlvblRvcGljOiBzbnMuVG9waWNcblxuICBjb25zdHJ1Y3RvciAoYXBwOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBd3NKd3RTdHNQcm9wcykge1xuICAgIHN1cGVyKGFwcCwgaWQpXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBDdXN0b20gZG9tYWluIHRoaW5naWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBsZXQgZGlzdHJpYnV0aW9uRG9tYWluTmFtZXM6IHN0cmluZ1tdID0gW11cbiAgICBsZXQgb2lkY0NlcnRpZmljYXRlOiBJQ2VydGlmaWNhdGUgfCB1bmRlZmluZWRcbiAgICBsZXQgdG9rZW5DZXJ0aWZpY2F0ZTogSUNlcnRpZmljYXRlIHwgdW5kZWZpbmVkXG4gICAgbGV0IGhvc3RlZFpvbmU6IElIb3N0ZWRab25lIHwgdW5kZWZpbmVkXG4gICAgY29uc3Qgb2lkY1N1YmRvbWFpbiA9IHByb3BzLm9pZGNTdWJkb21haW4gPyBwcm9wcy5vaWRjU3ViZG9tYWluIDogJ29pZGMnXG4gICAgY29uc3QgdG9rZW5TdWJkb21haW4gPSBwcm9wcy50b2tlblN1YmRvbWFpbiA/IHByb3BzLnRva2VuU3ViZG9tYWluIDogJ3Rva2VuJ1xuICAgIGNvbnN0IGFyY2hpdGVjdHVyZSA9IHByb3BzLmFyY2hpdGVjdHVyZSA/IHByb3BzLmFyY2hpdGVjdHVyZSA6IGxhbWJkYS5BcmNoaXRlY3R1cmUuWDg2XzY0XG4gICAgbGV0IG9pZGNEb21haW5OYW1lID0gJydcbiAgICBsZXQgdG9rZW5Eb21haW5OYW1lID0gJydcblxuICAgIGNvbnN0IHVzZUN1c3RvbURvbWFpbiA9IHByb3BzLmhvc3RlZFpvbmVJZCAmJiBwcm9wcy5ob3N0ZWRab25lTmFtZVxuXG4gICAgaWYgKHVzZUN1c3RvbURvbWFpbikge1xuICAgICAgb2lkY0RvbWFpbk5hbWUgPSBvaWRjU3ViZG9tYWluICsgJy4nICsgcHJvcHMuaG9zdGVkWm9uZU5hbWVcbiAgICAgIHRva2VuRG9tYWluTmFtZSA9IHRva2VuU3ViZG9tYWluICsgJy4nICsgcHJvcHMuaG9zdGVkWm9uZU5hbWVcblxuICAgICAgZGlzdHJpYnV0aW9uRG9tYWluTmFtZXMgPSBbb2lkY0RvbWFpbk5hbWVdXG5cbiAgICAgIGhvc3RlZFpvbmUgPSByb3V0ZTUzLkhvc3RlZFpvbmUuZnJvbUhvc3RlZFpvbmVBdHRyaWJ1dGVzKFxuICAgICAgICB0aGlzLFxuICAgICAgICAnaG9zdGVkWm9uZScsXG4gICAgICAgIHtcbiAgICAgICAgICB6b25lTmFtZTogcHJvcHMuaG9zdGVkWm9uZU5hbWUhLFxuICAgICAgICAgIGhvc3RlZFpvbmVJZDogcHJvcHMuaG9zdGVkWm9uZUlkIVxuICAgICAgICB9XG4gICAgICApXG5cbiAgICAgIG9pZGNDZXJ0aWZpY2F0ZSA9IG5ldyBhY20uRG5zVmFsaWRhdGVkQ2VydGlmaWNhdGUodGhpcywgJ0Nyb3NzUmVnaW9uQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgIGRvbWFpbk5hbWU6IG9pZGNEb21haW5OYW1lLFxuICAgICAgICBob3N0ZWRab25lLFxuICAgICAgICByZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICB9KVxuXG4gICAgICB0b2tlbkNlcnRpZmljYXRlID0gbmV3IGFjbS5DZXJ0aWZpY2F0ZSh0aGlzLCAndG9rZW5DZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgZG9tYWluTmFtZTogdG9rZW5Eb21haW5OYW1lLFxuICAgICAgICB2YWxpZGF0aW9uOiBhY20uQ2VydGlmaWNhdGVWYWxpZGF0aW9uLmZyb21EbnMoaG9zdGVkWm9uZSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gUzMgRGVmaW5pdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgLy8gQ3JlYXRlIGJ1Y2tldCB3aGVyZSBvaWRjIGluZm9ybWF0aW9uIGNhbiBiZSBzdG9yZWRcbiAgICBjb25zdCBvaWRjYnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnb2lkY2J1Y2tldCcsIHtcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IEJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTExcbiAgICB9KVxuXG4gICAgLyoqIC0tLS0tLS0tLS0tLS0tLS0tLS0gQ2xvdWRmcm9udCBEZWZpbml0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIGNvbnN0IGNsb3VkZnJvbnRPQUkgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5BY2Nlc3NJZGVudGl0eSh0aGlzLCAnY2xvdWRmcm9udC1PQUknLCB7XG4gICAgICBjb21tZW50OiAnT0FJIGZvciBvaWRjJ1xuICAgIH0pXG5cbiAgICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24odGhpcywgJ29pZGNEaXN0cmlidXRpb24nLCB7XG4gICAgICBkb21haW5OYW1lczogZGlzdHJpYnV0aW9uRG9tYWluTmFtZXMsXG4gICAgICBjb21tZW50OiAnRGlzY292ZXJ5IGVuZHBvaW50IGZvciBPSURDJyxcbiAgICAgIGNlcnRpZmljYXRlOiBvaWRjQ2VydGlmaWNhdGUsXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgY2xvdWRmcm9udE9yaWdpbnMuUzNPcmlnaW4ob2lkY2J1Y2tldCwgeyBvcmlnaW5BY2Nlc3NJZGVudGl0eTogY2xvdWRmcm9udE9BSSB9KSxcbiAgICAgICAgY29tcHJlc3M6IHRydWUsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8qKiAtLS0tLS0tLS0tLS0tLS0tLS0gTGFtYmRhIEhhbmRsZXJzIERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBjb25zdCBpc3N1ZXIgPSB1c2VDdXN0b21Eb21haW4gPyAnaHR0cHM6Ly8nICsgb2lkY0RvbWFpbk5hbWUgOiAnaHR0cHM6Ly8nICsgZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWVcblxuICAgIGNvbnN0IHJvdGF0ZUtleXNSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdyb3RhdGVLZXlzUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyldXG4gICAgfSlcbiAgICBjb25zdCByb3RhdGVLZXlzID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAna2V5cm90YXRlJywge1xuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIHJvbGU6IHJvdGF0ZUtleXNSb2xlLFxuICAgICAgYXJjaGl0ZWN0dXJlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgUzNfQlVDS0VUOiBvaWRjYnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIElTU1VFUjogaXNzdWVyLFxuICAgICAgICBDVVJSRU5UX0tFWTogcHJvcHMuY3VycmVudEtleU5hbWUgPz8gJ3N0cy9DVVJSRU5UJyxcbiAgICAgICAgUFJFVklPVVNfS0VZOiBwcm9wcy5wcmV2aW91c0tleU5hbWUgPz8gJ3N0cy9QUkVWSU9VUycsXG4gICAgICAgIFBFTkRJTkdfS0VZOiBwcm9wcy5wZW5kaW5nS2V5TmFtZSA/PyAnc3RzL1BFTkRJTkcnXG4gICAgICB9XG4gICAgfSlcblxuICAgIGNvbnN0IHNpZ25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdzaWduUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyldXG4gICAgfSlcbiAgICBjb25zdCBzaWduID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnc2lnbicsIHtcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICByb2xlOiBzaWduUm9sZSxcbiAgICAgIGFyY2hpdGVjdHVyZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIElTU1VFUjogaXNzdWVyLFxuICAgICAgICBERUZBVUxUX0FVRElFTkNFOiBwcm9wcy5kZWZhdWx0QXVkaWVuY2UsXG4gICAgICAgIENVUlJFTlRfS0VZOiBwcm9wcy5jdXJyZW50S2V5TmFtZSA/PyAnc3RzL0NVUlJFTlQnXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8qKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gU05TIFRvcGljIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIHRoaXMuZmFpbGVkUm90YXRpb25Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ3N0cycpXG4gICAgY29uc3Qgc25zRmFpbCA9IG5ldyB0YXNrcy5TbnNQdWJsaXNoKHRoaXMsICdzbnNGYWlsZWQnLCB7XG4gICAgICB0b3BpYzogdGhpcy5mYWlsZWRSb3RhdGlvblRvcGljLFxuICAgICAgc3ViamVjdDogJ1NUUyBLZXlSb3RhdGUgc3RlcCBmdW5jdGlvbiBleGVjdXRpb24gZmFpbGVkJyxcbiAgICAgIG1lc3NhZ2U6IHNmbi5UYXNrSW5wdXQuZnJvbUpzb25QYXRoQXQoJyQnKVxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tIFN0ZXAgZnVuY3Rpb25zIERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBjb25zdCBkZWxldGVQcmV2aW91c1N0ZXAgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdkZWxldGUgUHJldmlvdXMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcm90YXRlS2V5cyxcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHN0ZXA6ICdkZWxldGVQcmV2aW91cydcbiAgICAgIH0pLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCdcbiAgICB9KVxuXG4gICAgY29uc3QgbW92ZVByZXZpb3VzU3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ21vdmUgUHJldmlvdXMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcm90YXRlS2V5cyxcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHN0ZXA6ICdtb3ZlUHJldmlvdXMnXG4gICAgICB9KSxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnXG4gICAgfSlcblxuICAgIGNvbnN0IG1vdmVDdXJyZW50U3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ21vdmUgQ3VycmVudCcsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiByb3RhdGVLZXlzLFxuICAgICAgcGF5bG9hZDogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgc3RlcDogJ21vdmVDdXJyZW50J1xuICAgICAgfSksXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJ1xuICAgIH0pXG5cbiAgICBjb25zdCBjcmVhdGVQZW5kaW5nU3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ2NyZWF0ZSBQZW5kaW5nJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHJvdGF0ZUtleXMsXG4gICAgICBwYXlsb2FkOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBzdGVwOiAnY3JlYXRlUGVuZGluZydcbiAgICAgIH0pLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCdcbiAgICB9KVxuXG4gICAgY29uc3QgZ2VuZXJhdGVBcnRpZmFjdHNTdGVwID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnZ2VuZXJhdGUgYXJ0aWZhY3RzJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHJvdGF0ZUtleXMsXG4gICAgICBwYXlsb2FkOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBzdGVwOiAnZ2VuZXJhdGVBcnRpZmFjdHMnXG4gICAgICB9KSxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnXG4gICAgfSlcblxuICAgIGNvbnN0IGpvYkZhaWxlZCA9IG5ldyBzZm4uRmFpbCh0aGlzLCAnRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdBV1MgQmF0Y2ggSm9iIEZhaWxlZCcsXG4gICAgICBlcnJvcjogJ0Rlc2NyaWJlSm9iIHJldHVybmVkIEZBSUxFRCdcbiAgICB9KVxuXG4gICAgY29uc3Qgam9iU3VjY2VzcyA9IG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnU3VjY2VzcyEnKVxuXG4gICAgZGVsZXRlUHJldmlvdXNTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG4gICAgbW92ZVByZXZpb3VzU3RlcC5hZGRDYXRjaChzbnNGYWlsKVxuICAgIG1vdmVDdXJyZW50U3RlcC5hZGRDYXRjaChzbnNGYWlsKVxuICAgIGNyZWF0ZVBlbmRpbmdTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG4gICAgZ2VuZXJhdGVBcnRpZmFjdHNTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG5cbiAgICAvLyBDcmVhdGUgY2hhaW5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gZGVsZXRlUHJldmlvdXNTdGVwXG4gICAgICAubmV4dChtb3ZlUHJldmlvdXNTdGVwKVxuICAgICAgLm5leHQobW92ZUN1cnJlbnRTdGVwKVxuICAgICAgLm5leHQoY3JlYXRlUGVuZGluZ1N0ZXApXG4gICAgICAubmV4dChnZW5lcmF0ZUFydGlmYWN0c1N0ZXApXG4gICAgICAubmV4dChqb2JTdWNjZXNzKVxuXG4gICAgc25zRmFpbC5uZXh0KGpvYkZhaWxlZClcblxuICAgIC8vIENyZWF0ZSBzdGF0ZSBtYWNoaW5lXG4gICAgY29uc3Qgcm90YXRlS2V5c01hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZSh0aGlzLCAnUm90YXRlS2V5cycsIHtcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShcbiAgICAgICAgZGVmaW5pdGlvblxuICAgICAgKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpXG4gICAgfSlcblxuICAgIHJvdGF0ZUtleXMuZ3JhbnRJbnZva2Uocm90YXRlS2V5c01hY2hpbmUucm9sZSlcbiAgICBvaWRjYnVja2V0LmdyYW50UmVhZFdyaXRlKHJvdGF0ZUtleXMpXG5cbiAgICBjb25zdCBzdGF0ZW1lbnRTaWduID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoKVxuICAgIHN0YXRlbWVudFNpZ24uYWRkQWN0aW9ucygna21zOionKVxuICAgIHN0YXRlbWVudFNpZ24uYWRkUmVzb3VyY2VzKCcqJylcbiAgICBjb25zdCBzaWduUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdTaWduUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW3N0YXRlbWVudFNpZ25dXG4gICAgfSlcbiAgICBzaWduUm9sZS5hZGRNYW5hZ2VkUG9saWN5KHNpZ25Qb2xpY3kpXG5cbiAgICBjb25zdCBzdGF0ZW1lbnRSb3RhdGVLZXlzID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoKVxuICAgIHN0YXRlbWVudFJvdGF0ZUtleXMuYWRkQWN0aW9ucygna21zOionKVxuICAgIHN0YXRlbWVudFJvdGF0ZUtleXMuYWRkUmVzb3VyY2VzKCcqJylcbiAgICBjb25zdCByb3RhdGVLZXlzUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdSb3RhdGVLZXlzUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW3N0YXRlbWVudFJvdGF0ZUtleXNdXG4gICAgfSlcbiAgICByb3RhdGVLZXlzUm9sZS5hZGRNYW5hZ2VkUG9saWN5KHJvdGF0ZUtleXNQb2xpY3kpXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tIEV2ZW50cyBSdWxlIERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICAvLyBSdW4gZXZlcnkgMyBtb250aHMgYXQgOCBQTSBVVENcbiAgICBjb25zdCBzY2hlZHVsZWRSb3RhdGVSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdzY2hlZHVsZWRSb3RhdGVSdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5leHByZXNzaW9uKCdjcm9uKDAgMjAgMSAqLzMgPyAqKScpXG4gICAgfSlcbiAgICBzY2hlZHVsZWRSb3RhdGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TZm5TdGF0ZU1hY2hpbmUocm90YXRlS2V5c01hY2hpbmUpKVxuXG4gICAgLy8gQ3JlYXRlIHN0YXRlIG1hY2hpbmUgYW5kIHRyaWdnZXIgdG8gcG9wdWxhdGUgaW5pdGlhbCBrZXlzXG4gICAgaWYgKCFwcm9wcy5kaXNhYmxlS2V5Um90YXRlT25DcmVhdGUpIHtcbiAgICAgIGNvbnN0IHJvdGF0ZU9uY2UgPSBuZXcgdGFza3MuU3RlcEZ1bmN0aW9uc1N0YXJ0RXhlY3V0aW9uKHRoaXMsICdyb3RhdGVPbmNlJywge1xuICAgICAgICBzdGF0ZU1hY2hpbmU6IHJvdGF0ZUtleXNNYWNoaW5lLFxuICAgICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHNmbi5JbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQlxuICAgICAgfSlcblxuICAgICAgY29uc3Qgcm90YXRlVHdpY2UgPSBuZXcgdGFza3MuU3RlcEZ1bmN0aW9uc1N0YXJ0RXhlY3V0aW9uKHRoaXMsICdyb3RhdGVUd2ljZScsIHtcbiAgICAgICAgc3RhdGVNYWNoaW5lOiByb3RhdGVLZXlzTWFjaGluZSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0JcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHBvcHVsYXRlS2V5cyA9IG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsICdwb3B1bGF0ZUtleXMnLCB7XG4gICAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShcbiAgICAgICAgICByb3RhdGVPbmNlLm5leHQocm90YXRlVHdpY2UpXG4gICAgICAgICksXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgaW5pdGlhbFJ1blJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ2luaXRpYWxSdW5SdWxlJywge1xuICAgICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgICBzb3VyY2U6IFsnYXdzLmNsb3VkZm9ybWF0aW9uJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbY2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrSWRdLFxuICAgICAgICAgIGRldGFpbFR5cGU6IFsnQ2xvdWRGb3JtYXRpb24gU3RhY2sgU3RhdHVzIENoYW5nZSddLFxuICAgICAgICAgIGRldGFpbDoge1xuICAgICAgICAgICAgJ3N0YXR1cy1kZXRhaWxzJzoge1xuICAgICAgICAgICAgICBzdGF0dXM6IFsnQ1JFQVRFX0NPTVBMRVRFJ11cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGluaXRpYWxSdW5SdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TZm5TdGF0ZU1hY2hpbmUocG9wdWxhdGVLZXlzKSlcbiAgICB9XG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBBUEkgR2F0ZXdheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgLy8gb25seSBzZXQgcG9saWN5IHdoZW4gb3JnSWQgaXMgc2V0XG4gICAgbGV0IGFwaVBvbGljeTogUG9saWN5RG9jdW1lbnQgfCB1bmRlZmluZWRcbiAgICBpZiAocHJvcHMub3JnSWQpIHtcbiAgICAgIGFwaVBvbGljeSA9IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpJbnZva2UnXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbXG4gICAgICAgICAgICAgIG5ldyBPcmdhbml6YXRpb25QcmluY2lwYWwocHJvcHMub3JnSWQpXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSlcbiAgICAgICAgXVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdBUElHYXRld2F5QWNjZXNzTG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogN1xuICAgIH0pXG5cbiAgICAvLyBDcmVhdGUgQVBJXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhUmVzdEFwaSh0aGlzLCAnandrLXN0cy1hcGknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1NUUyBUb2tlbiBBUEkgR2F0ZXdheScsXG4gICAgICBoYW5kbGVyOiBzaWduLFxuICAgICAgZGVmYXVsdE1ldGhvZE9wdGlvbnM6IHtcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNXG4gICAgICB9LFxuICAgICAgZW5kcG9pbnRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHR5cGVzOiBbYXBpZ2F0ZXdheS5FbmRwb2ludFR5cGUuUkVHSU9OQUxdXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBhcGlQb2xpY3ksXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIGxvZ2dpbmdMZXZlbDogTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKGxvZ0dyb3VwKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLSBSb3V0ZTUzIERlZmluaXRpb24gZm9yIGN1c3RvbSBkb21haW4gLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgaWYgKHVzZUN1c3RvbURvbWFpbiAmJiBob3N0ZWRab25lKSB7XG4gICAgICBhcGkuYWRkRG9tYWluTmFtZSgnYXBpQ3VzdG9tRG9tYWluTmFtZScsIHtcbiAgICAgICAgZG9tYWluTmFtZTogdG9rZW5Eb21haW5OYW1lLFxuICAgICAgICBjZXJ0aWZpY2F0ZTogdG9rZW5DZXJ0aWZpY2F0ZSFcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFkZCBBIHJlY29yZCBmb3IgY2xvdWRmcm9udCBkaXN0cmlidXRpb25cblxuICAgICAgbmV3IHJvdXRlNTMuQVJlY29yZCh0aGlzLCAnb2lkY1JlY29yZCcsIHtcbiAgICAgICAgcmVjb3JkTmFtZTogb2lkY0RvbWFpbk5hbWUsXG4gICAgICAgIHpvbmU6IGhvc3RlZFpvbmUsXG4gICAgICAgIHRhcmdldDogcm91dGU1My5SZWNvcmRUYXJnZXQuZnJvbUFsaWFzKG5ldyByb3V0ZTUzdGFyZ2V0cy5DbG91ZEZyb250VGFyZ2V0KGRpc3RyaWJ1dGlvbikpXG4gICAgICB9KVxuXG4gICAgICBuZXcgcm91dGU1My5BUmVjb3JkKHRoaXMsICd0b2tlblJlY29yZCcsIHtcbiAgICAgICAgcmVjb3JkTmFtZTogdG9rZW5Eb21haW5OYW1lLFxuICAgICAgICB6b25lOiBob3N0ZWRab25lLFxuICAgICAgICB0YXJnZXQ6IHJvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhuZXcgcm91dGU1M3RhcmdldHMuQXBpR2F0ZXdheShhcGkpKVxuICAgICAgfSlcblxuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ3Rva2VuRW5kcG9pbnQnLCB7XG4gICAgICAgIHZhbHVlOiAnaHR0cHM6Ly8nICsgdG9rZW5Eb21haW5OYW1lICsgJy90b2tlbicsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXJsIG9mIHRoZSB0b2tlbiBlbmRwb2ludCcsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0tdG9rZW5FbmRwb2ludGBcbiAgICAgIH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICd0b2tlbkVuZHBvaW50Jywge1xuICAgICAgICB2YWx1ZTogYXBpLnVybCArICd0b2tlbicsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXJsIG9mIHRoZSB0b2tlbiBlbmRwb2ludCcsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0tdG9rZW5FbmRwb2ludGBcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ2lzc3VlcicsIHtcbiAgICAgIHZhbHVlOiBpc3N1ZXIsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VybCBvZiB0aGUgaXNzdWVyJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0taXNzdWVyYFxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBXQUYgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIGlmIChwcm9wcy5hcGlHd1dhZiA9PT0gd2FmVXNhZ2UuQ29uc3RydWN0UHJvdmlkZWQpIHtcbiAgICAgIC8vIEFQSSBnYXRld2F5IFdBRiBBQ0wgYW5kIHJ1bGVzXG4gICAgICBjb25zdCBBUElHYXRld2F5V2ViQUNMID0gbmV3IHdhZnYyLkNmbldlYkFDTCh0aGlzLCAnQVBJR2F0ZXdheVdlYkFDTCcsIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIFdlYkFDTCBmb3IgQXV0aCBBUGkgR2F0ZXdheScsXG4gICAgICAgIHNjb3BlOiAnUkVHSU9OQUwnLFxuICAgICAgICBkZWZhdWx0QWN0aW9uOiB7IGFsbG93OiB7fSB9LFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgbWV0cmljTmFtZTogJ0FQSVdlYkFDTCcsXG4gICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnQVdTLUFXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIHZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0J1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHtcbiAgICAgICAgICAgICAgbm9uZToge31cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FXUy1BV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ0FXUy1BV1NNYW5hZ2VkUnVsZXNBbWF6b25JcFJlcHV0YXRpb25MaXN0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgICB2ZW5kb3JOYW1lOiAnQVdTJyxcbiAgICAgICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQW1hem9uSXBSZXB1dGF0aW9uTGlzdCdcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG92ZXJyaWRlQWN0aW9uOiB7XG4gICAgICAgICAgICAgIG5vbmU6IHt9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBV1MtQVdTTWFuYWdlZFJ1bGVzQW1hem9uSXBSZXB1dGF0aW9uTGlzdCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdhcGktZ3ctQXV0aEFQSUdlb0xvY2F0aW9uJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAzLFxuICAgICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXV0aEFQSUdlb0xvY2F0aW9uJyxcbiAgICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiBmYWxzZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBnZW9NYXRjaFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGNvdW50cnlDb2RlczogWydCWScsICdDTicsICdJUicsICdSVScsICdTWScsICdLUCddXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdhcGktZ3ctcmF0ZUxpbWl0UnVsZScsXG4gICAgICAgICAgICBwcmlvcml0eTogNCxcbiAgICAgICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcbiAgICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ3JhdGVMaW1pdFJ1bGUnLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IGZhbHNlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgICAgICAgbGltaXQ6IDEwMFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9KVxuXG4gICAgICAvLyBXZWIgQUNMIEFzc29jaWF0aW9uXG4gICAgICBuZXcgd2FmdjIuQ2ZuV2ViQUNMQXNzb2NpYXRpb24odGhpcywgJ0FQSUdhdGV3YXlXZWJBQ0xBc3NvY2lhdGlvbicsIHtcbiAgICAgICAgd2ViQWNsQXJuOiBBUElHYXRld2F5V2ViQUNMLmF0dHJBcm4sXG4gICAgICAgIHJlc291cmNlQXJuOiBhcGkuZGVwbG95bWVudFN0YWdlLnN0YWdlQXJuXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAocHJvcHMuYXBpR3dXYWYgPT09IHdhZlVzYWdlLlByb3ZpZGVXZWJBY2xBcm4gJiYgcHJvcHMuYXBpR3dXYWZXZWJBY2xBcm4pIHtcbiAgICAgIC8vIFdlYiBBQ0wgQXNzb2NpYXRpb25cbiAgICAgIG5ldyB3YWZ2Mi5DZm5XZWJBQ0xBc3NvY2lhdGlvbih0aGlzLCAnQVBJR2F0ZXdheVdlYkFDTEFzc29jaWF0aW9uJywge1xuICAgICAgICB3ZWJBY2xBcm46IHByb3BzLmFwaUd3V2FmV2ViQWNsQXJuLFxuICAgICAgICByZXNvdXJjZUFybjogYXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZUFyblxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBDbG91ZHdhdGNoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnU3RlcEZ1bmN0aW9uRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUtleVJvdGF0aW9uU3RlcEZ1bmN0aW9uRmFpbGVkID8/ICdzdHMta2V5X3JvdGF0ZV9zZm4tYWxhcm0nLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBtZXRyaWM6IHJvdGF0ZUtleXNNYWNoaW5lLm1ldHJpY0ZhaWxlZCgpLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0tleSBSb3RhdGlvbiBGYWlsZWQnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSlcblxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGlHYXRld2F5NVhYQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUFwaUdhdGV3YXk1eHggPz8gJ3N0cy01eHhfYXBpX2d3LWFsYXJtJyxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgbWV0cmljOiBhcGkubWV0cmljU2VydmVyRXJyb3IoKSxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICc1eHggU1RTIEFQSSBnYXRld2F5IGZhaWx1cmVzJyxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IFRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pXG5cbiAgICBjb25zdCBzaWduRXJyb3JzID0gc2lnbi5tZXRyaWNFcnJvcnMoe1xuICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKVxuICAgIH0pXG5cbiAgICBjb25zdCByb3RhdGVFcnJvcnMgPSByb3RhdGVLZXlzLm1ldHJpY0Vycm9ycyh7XG4gICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpXG4gICAgfSlcblxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMYW1iZGFTaWduRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZVNpZ25MYW1iZGFGYWlsZWQgPz8gJ3N0cy1zaWduX2Vycm9yc19sYW1iZGEtYWxhcm0nLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBtZXRyaWM6IHNpZ25FcnJvcnMsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnU2lnbiBMYW1iZGEgRmFpbGVkJyxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IFRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pXG5cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhUm90YXRlRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUtleVJvdGF0aW9uTGFtYmRhRmFpbGVkID8/ICdzdHMta2V5X3JvdGF0ZV9lcnJvcnNfbGFtYmRhLWFsYXJtJyxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgbWV0cmljOiByb3RhdGVFcnJvcnMsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnS2V5IFJvdGF0aW9uIExhbWJkYSBGYWlsZWQnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSlcbiAgfVxufVxuIl19