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
                CURRENT_KEY: 'alias/' + ((_a = props.currentKeyName) !== null && _a !== void 0 ? _a : 'sts/CURRENT'),
                PREVIOUS_KEY: 'alias/' + ((_b = props.previousKeyName) !== null && _b !== void 0 ? _b : 'sts/PREVIOUS'),
                PENDING_KEY: 'alias/' + ((_c = props.pendingKeyName) !== null && _c !== void 0 ? _c : 'sts/PENDING')
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
                CURRENT_KEY: 'alias/' + ((_d = props.currentKeyName) !== null && _d !== void 0 ? _d : 'sts/CURRENT')
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLDRDQUE0QztBQUM1QyxFQUFFO0FBQ0Ysc0NBQXNDOzs7QUFFdEMsbUNBQW1DO0FBQ25DLG1DQUFrQztBQUNsQyxpREFBZ0Q7QUFDaEQscURBQW9EO0FBQ3BELDZEQUE0RDtBQUM1RCwyQ0FBMEM7QUFDMUMsaURBQTJFO0FBQzNFLHlDQUF3QztBQUN4QywrQ0FBcUQ7QUFDckQseURBQXdEO0FBQ3hELHdFQUF1RTtBQUN2RSxpREFBZ0Q7QUFDaEQsMERBQXlEO0FBQ3pELDBEQUF5RDtBQUN6RCxtREFBa0Q7QUFDbEQsa0VBQWlFO0FBQ2pFLHlEQUF3RDtBQUN4RCwrREFBK0Q7QUFDL0QsK0NBQThDO0FBQzlDLDJDQUEwQztBQUMxQyw2Q0FBNEM7QUFDNUMseURBQXdEO0FBQ3hELCtEQUE2RDtBQUM3RCw4REFBNkQ7QUFDN0QsMkNBQXNDO0FBSXRDLElBQVksUUFHWDtBQUhELFdBQVksUUFBUTtJQUNsQixpRUFBaUIsQ0FBQTtJQUNqQiwrREFBZ0IsQ0FBQTtBQUNsQixDQUFDLEVBSFcsUUFBUSx3QkFBUixRQUFRLFFBR25CO0FBK0ZELDJCQUEyQjtBQUMzQixNQUFhLFNBQVUsU0FBUSxzQkFBUztJQU10QyxZQUFhLEdBQWMsRUFBRSxFQUFVLEVBQUUsS0FBcUI7O1FBQzVELEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFZCw0RUFBNEU7UUFFNUUsSUFBSSx1QkFBdUIsR0FBYSxFQUFFLENBQUE7UUFDMUMsSUFBSSxlQUF5QyxDQUFBO1FBQzdDLElBQUksZ0JBQTBDLENBQUE7UUFDOUMsSUFBSSxVQUFtQyxDQUFBO1FBQ3ZDLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQTtRQUN4RSxNQUFN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Q0Y7QUF4ZUQsOEJBd2VDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gU1BEWC1GaWxlQ29weXJpZ2h0VGV4dDogMjAyMyBBbGxpYW5kZXIgTlZcbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4vKiBlc2xpbnQtZGlzYWJsZSBuby11bnVzZWQtdmFycyAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnXG5pbXBvcnQgKiBhcyBzZm4gZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnXG5pbXBvcnQgKiBhcyB0YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcydcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJ1xuaW1wb3J0IHsgT3JnYW5pemF0aW9uUHJpbmNpcGFsLCBQb2xpY3lEb2N1bWVudCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXG5pbXBvcnQgeyBCdWNrZXRFbmNyeXB0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCdcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnRPcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cydcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJ1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInXG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJ1xuaW1wb3J0ICogYXMgcm91dGU1M3RhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJvdXRlNTMtdGFyZ2V0cydcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknXG5pbXBvcnQgeyBNZXRob2RMb2dnaW5nTGV2ZWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSdcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy13YWZ2MidcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJ1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncydcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgeyBUcmVhdE1pc3NpbmdEYXRhIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgKiBhcyBsYW1iZGFOb2RlanMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0IHsgSUNlcnRpZmljYXRlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlcidcbmltcG9ydCB7IElIb3N0ZWRab25lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXJvdXRlNTMnXG5cbmV4cG9ydCBlbnVtIHdhZlVzYWdlIHtcbiAgQ29uc3RydWN0UHJvdmlkZWQsXG4gIFByb3ZpZGVXZWJBY2xBcm5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBBd3NKd3RTdHNQcm9wcyB7XG4gIC8qKlxuICAgKiBkZWZhdWx0QXVkaWVuY2Ugd2hpY2ggaXMgdXNlZCBpbiBkZSBKV1Qnc1xuICAgKi9cbiAgcmVhZG9ubHkgZGVmYXVsdEF1ZGllbmNlOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEhvc3RlZFpvbmVJZCBvZiB0aGUgZG9tYWluIHVzZWQgZm9yIGhvc3RpbmcgdGhlIHN0cyBmdW5jdGlvblxuICAgKi9cbiAgcmVhZG9ubHkgaG9zdGVkWm9uZUlkPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBOYW1lIG9mIHRoZSBob3N0ZWRab25lLlxuICAgKi9cbiAgcmVhZG9ubHkgaG9zdGVkWm9uZU5hbWU/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICogT3B0aW9uYWwgc3ViZG9tYWluIG5hbWUgb2Ygb2lkYyBkaXNjb3ZlcnksIGRlZmF1bHQ6IG9pZGMuXG4gICovXG4gIHJlYWRvbmx5IG9pZGNTdWJkb21haW4/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICogT3B0aW9uYWwgc3ViZG9tYWluIG5hbWUgb2YgdGhlIHRva2VuIGFwaSAob24gYXBpIGd3KSwgZGVmYXVsdDogdG9rZW4uXG4gICovXG4gIHJlYWRvbmx5IHRva2VuU3ViZG9tYWluPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJZiB3YWYgbmVlZHMgdG8gYmUgYWRkZWQgdG8gdGhlIEFQSSBHV1xuICAgKlxuICAgKiBOb25lOiBubyB3YWYgaXMgdXNlZFxuICAgKiBDb25zdHJ1Y3RQcm92aWRlZDogdGhlIGNvbnN0cnVjdCB3aWxsIGRlcGxveSBhIHdhZkFjbCB3aXRoIG9waW5pb25hdGVkIHJ1bGVzXG4gICAqIFByb3ZpZGVXZWJBY2xBcm46IHByb3ZpZGUgeW91ciBvd24gYXJuXG4gICAqL1xuICByZWFkb25seSBhcGlHd1dhZj86IHdhZlVzYWdlO1xuXG4gIC8qKlxuICAgKiBBcm4gb2YgdGhlIHdhZiB3ZWJBY2wgcnVsZSB0byBiZSBhc3NvY2lhdGVkIHdpdGggdGhlIEFQSSBHV1xuICAgKlxuICAgKi9cbiAgcmVhZG9ubHkgYXBpR3dXYWZXZWJBY2xBcm4/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBJRCBvZiB0aGUgQVdTIE9yZ2FuaXphdGlvbiAwLXh4eHhcbiAgICpcbiAgICovXG4gIHJlYWRvbmx5IG9yZ0lkPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDUFUgQXJjaGl0ZWN0dXJlXG4gICAqL1xuICByZWFkb25seSBhcmNoaXRlY3R1cmU/OiBsYW1iZGEuQXJjaGl0ZWN0dXJlXG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGJvb2xlYW4gdG8gc3BlY2lmeSBpZiBrZXkgcm90YXRpb24gc2hvdWxkIGJlIHRyaWdnZXJlZCBvbiBjcmVhdGlvbiBvZiB0aGUgc3RhY2ssIGRlZmF1bHQ6IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBkaXNhYmxlS2V5Um90YXRlT25DcmVhdGU/OiBib29sZWFuXG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGN1c3RvbSBuYW1lIGZvciB0aGUgQ2xvdWRXYXRjaCBBbGFybSBtb25pdG9yaW5nIFN0ZXAgRnVuY3Rpb24gZmFpbHVyZXMsIGRlZmF1bHQ6IHN0cy1rZXlfcm90YXRlX3Nmbi1hbGFybVxuICAgKi9cbiAgcmVhZG9ubHkgYWxhcm1OYW1lS2V5Um90YXRpb25TdGVwRnVuY3Rpb25GYWlsZWQ/OiBzdHJpbmdcblxuICAvKipcbiAgICogT3B0aW9uYWwgY3VzdG9tIG5hbWUgZm9yIHRoZSBDbG91ZFdhdGNoIEFsYXJtIG1vbml0b3JpbmcgNXh4IGVycm9ycyBvbiB0aGUgQVBJIEdhdGV3YXksIGRlZmF1bHQ6IHN0cy01eHhfYXBpX2d3LWFsYXJtXG4gICAqL1xuICByZWFkb25seSBhbGFybU5hbWVBcGlHYXRld2F5NXh4Pzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGN1c3RvbSBuYW1lIGZvciB0aGUgQ2xvdWRXYXRjaCBBbGFybSBtb25pdG9yaW5nIFNpZ24gTGFtYmRhIGZhaWx1cmVzLCBkZWZhdWx0OiBzdHMtc2lnbl9lcnJvcnNfbGFtYmRhLWFsYXJtXG4gICAqL1xuICByZWFkb25seSBhbGFybU5hbWVTaWduTGFtYmRhRmFpbGVkPzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGN1c3RvbSBuYW1lIGZvciB0aGUgQ2xvdWRXYXRjaCBBbGFybSBtb25pdG9yaW5nIEtleSBSb3RhdGlvbiBMYW1iZGEgZmFpbHVyZXMsIGRlZmF1bHQ6IHN0cy1rZXlfcm90YXRlX2Vycm9yc19sYW1iZGEtYWxhcm1cbiAgICovXG4gIHJlYWRvbmx5IGFsYXJtTmFtZUtleVJvdGF0aW9uTGFtYmRhRmFpbGVkPzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIGN1cnJlbnQga21zIGtleSBuYW1lXG4gICAqL1xuICByZWFkb25seSBjdXJyZW50S2V5TmFtZT86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBwcmV2aW91cyBrbXMga2V5IG5hbWVcbiAgICovXG4gIHJlYWRvbmx5IHByZXZpb3VzS2V5TmFtZT86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBwZW5kaW5nIGttcyBrZXkgbmFtZVxuICAgKi9cbiAgcmVhZG9ubHkgcGVuZGluZ0tleU5hbWU/OiBzdHJpbmdcbn1cblxuLyogZXNsaW50LWRpc2FibGUgbm8tbmV3ICovXG5leHBvcnQgY2xhc3MgQXdzSnd0U3RzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIFNOUyB0b3BpYyB1c2VkIHRvIHB1Ymxpc2ggZXJyb3JzIGZyb20gdGhlIFN0ZXAgRnVuY3Rpb24gcm90YXRpb24gZmxvd1xuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGZhaWxlZFJvdGF0aW9uVG9waWM6IHNucy5Ub3BpY1xuXG4gIGNvbnN0cnVjdG9yIChhcHA6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEF3c0p3dFN0c1Byb3BzKSB7XG4gICAgc3VwZXIoYXBwLCBpZClcblxuICAgIC8qKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEN1c3RvbSBkb21haW4gdGhpbmdpZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIGxldCBkaXN0cmlidXRpb25Eb21haW5OYW1lczogc3RyaW5nW10gPSBbXVxuICAgIGxldCBvaWRjQ2VydGlmaWNhdGU6IElDZXJ0aWZpY2F0ZSB8IHVuZGVmaW5lZFxuICAgIGxldCB0b2tlbkNlcnRpZmljYXRlOiBJQ2VydGlmaWNhdGUgfCB1bmRlZmluZWRcbiAgICBsZXQgaG9zdGVkWm9uZTogSUhvc3RlZFpvbmUgfCB1bmRlZmluZWRcbiAgICBjb25zdCBvaWRjU3ViZG9tYWluID0gcHJvcHMub2lkY1N1YmRvbWFpbiA/IHByb3BzLm9pZGNTdWJkb21haW4gOiAnb2lkYydcbiAgICBjb25zdCB0b2tlblN1YmRvbWFpbiA9IHByb3BzLnRva2VuU3ViZG9tYWluID8gcHJvcHMudG9rZW5TdWJkb21haW4gOiAndG9rZW4nXG4gICAgY29uc3QgYXJjaGl0ZWN0dXJlID0gcHJvcHMuYXJjaGl0ZWN0dXJlID8gcHJvcHMuYXJjaGl0ZWN0dXJlIDogbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjRcbiAgICBsZXQgb2lkY0RvbWFpbk5hbWUgPSAnJ1xuICAgIGxldCB0b2tlbkRvbWFpbk5hbWUgPSAnJ1xuXG4gICAgY29uc3QgdXNlQ3VzdG9tRG9tYWluID0gcHJvcHMuaG9zdGVkWm9uZUlkICYmIHByb3BzLmhvc3RlZFpvbmVOYW1lXG5cbiAgICBpZiAodXNlQ3VzdG9tRG9tYWluKSB7XG4gICAgICBvaWRjRG9tYWluTmFtZSA9IG9pZGNTdWJkb21haW4gKyAnLicgKyBwcm9wcy5ob3N0ZWRab25lTmFtZVxuICAgICAgdG9rZW5Eb21haW5OYW1lID0gdG9rZW5TdWJkb21haW4gKyAnLicgKyBwcm9wcy5ob3N0ZWRab25lTmFtZVxuXG4gICAgICBkaXN0cmlidXRpb25Eb21haW5OYW1lcyA9IFtvaWRjRG9tYWluTmFtZV1cblxuICAgICAgaG9zdGVkWm9uZSA9IHJvdXRlNTMuSG9zdGVkWm9uZS5mcm9tSG9zdGVkWm9uZUF0dHJpYnV0ZXMoXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdob3N0ZWRab25lJyxcbiAgICAgICAge1xuICAgICAgICAgIHpvbmVOYW1lOiBwcm9wcy5ob3N0ZWRab25lTmFtZSEsXG4gICAgICAgICAgaG9zdGVkWm9uZUlkOiBwcm9wcy5ob3N0ZWRab25lSWQhXG4gICAgICAgIH1cbiAgICAgIClcblxuICAgICAgb2lkY0NlcnRpZmljYXRlID0gbmV3IGFjbS5EbnNWYWxpZGF0ZWRDZXJ0aWZpY2F0ZSh0aGlzLCAnQ3Jvc3NSZWdpb25DZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgZG9tYWluTmFtZTogb2lkY0RvbWFpbk5hbWUsXG4gICAgICAgIGhvc3RlZFpvbmUsXG4gICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgIH0pXG5cbiAgICAgIHRva2VuQ2VydGlmaWNhdGUgPSBuZXcgYWNtLkNlcnRpZmljYXRlKHRoaXMsICd0b2tlbkNlcnRpZmljYXRlJywge1xuICAgICAgICBkb21haW5OYW1lOiB0b2tlbkRvbWFpbk5hbWUsXG4gICAgICAgIHZhbGlkYXRpb246IGFjbS5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhob3N0ZWRab25lKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBTMyBEZWZpbml0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICAvLyBDcmVhdGUgYnVja2V0IHdoZXJlIG9pZGMgaW5mb3JtYXRpb24gY2FuIGJlIHN0b3JlZFxuICAgIGNvbnN0IG9pZGNidWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdvaWRjYnVja2V0Jywge1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTFxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLSBDbG91ZGZyb250IERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgY29uc3QgY2xvdWRmcm9udE9BSSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpbkFjY2Vzc0lkZW50aXR5KHRoaXMsICdjbG91ZGZyb250LU9BSScsIHtcbiAgICAgIGNvbW1lbnQ6ICdPQUkgZm9yIG9pZGMnXG4gICAgfSlcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCAnb2lkY0Rpc3RyaWJ1dGlvbicsIHtcbiAgICAgIGRvbWFpbk5hbWVzOiBkaXN0cmlidXRpb25Eb21haW5OYW1lcyxcbiAgICAgIGNvbW1lbnQ6ICdEaXNjb3ZlcnkgZW5kcG9pbnQgZm9yIE9JREMnLFxuICAgICAgY2VydGlmaWNhdGU6IG9pZGNDZXJ0aWZpY2F0ZSxcbiAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICBvcmlnaW46IG5ldyBjbG91ZGZyb250T3JpZ2lucy5TM09yaWdpbihvaWRjYnVja2V0LCB7IG9yaWdpbkFjY2Vzc0lkZW50aXR5OiBjbG91ZGZyb250T0FJIH0pLFxuICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFNcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLyoqIC0tLS0tLS0tLS0tLS0tLS0tLSBMYW1iZGEgSGFuZGxlcnMgRGVmaW5pdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIGNvbnN0IGlzc3VlciA9IHVzZUN1c3RvbURvbWFpbiA/ICdodHRwczovLycgKyBvaWRjRG9tYWluTmFtZSA6ICdodHRwczovLycgKyBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZVxuXG4gICAgY29uc3Qgcm90YXRlS2V5c1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ3JvdGF0ZUtleXNSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV1cbiAgICB9KVxuICAgIGNvbnN0IHJvdGF0ZUtleXMgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdrZXlyb3RhdGUnLCB7XG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgcm9sZTogcm90YXRlS2V5c1JvbGUsXG4gICAgICBhcmNoaXRlY3R1cmUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBTM19CVUNLRVQ6IG9pZGNidWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgSVNTVUVSOiBpc3N1ZXIsXG4gICAgICAgIENVUlJFTlRfS0VZOiAnYWxpYXMvJyArIChwcm9wcy5jdXJyZW50S2V5TmFtZSA/PyAnc3RzL0NVUlJFTlQnKSxcbiAgICAgICAgUFJFVklPVVNfS0VZOiAnYWxpYXMvJyArIChwcm9wcy5wcmV2aW91c0tleU5hbWUgPz8gJ3N0cy9QUkVWSU9VUycpLFxuICAgICAgICBQRU5ESU5HX0tFWTogJ2FsaWFzLycgKyAocHJvcHMucGVuZGluZ0tleU5hbWUgPz8gJ3N0cy9QRU5ESU5HJylcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgY29uc3Qgc2lnblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ3NpZ25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV1cbiAgICB9KVxuICAgIGNvbnN0IHNpZ24gPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdzaWduJywge1xuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIHJvbGU6IHNpZ25Sb2xlLFxuICAgICAgYXJjaGl0ZWN0dXJlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgSVNTVUVSOiBpc3N1ZXIsXG4gICAgICAgIERFRkFVTFRfQVVESUVOQ0U6IHByb3BzLmRlZmF1bHRBdWRpZW5jZSxcbiAgICAgICAgQ1VSUkVOVF9LRVk6ICdhbGlhcy8nICsgKHByb3BzLmN1cnJlbnRLZXlOYW1lID8/ICdzdHMvQ1VSUkVOVCcpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8qKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gU05TIFRvcGljIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIHRoaXMuZmFpbGVkUm90YXRpb25Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ3N0cycpXG4gICAgY29uc3Qgc25zRmFpbCA9IG5ldyB0YXNrcy5TbnNQdWJsaXNoKHRoaXMsICdzbnNGYWlsZWQnLCB7XG4gICAgICB0b3BpYzogdGhpcy5mYWlsZWRSb3RhdGlvblRvcGljLFxuICAgICAgc3ViamVjdDogJ1NUUyBLZXlSb3RhdGUgc3RlcCBmdW5jdGlvbiBleGVjdXRpb24gZmFpbGVkJyxcbiAgICAgIG1lc3NhZ2U6IHNmbi5UYXNrSW5wdXQuZnJvbUpzb25QYXRoQXQoJyQnKVxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tIFN0ZXAgZnVuY3Rpb25zIERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBjb25zdCBkZWxldGVQcmV2aW91c1N0ZXAgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdkZWxldGUgUHJldmlvdXMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcm90YXRlS2V5cyxcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHN0ZXA6ICdkZWxldGVQcmV2aW91cydcbiAgICAgIH0pLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCdcbiAgICB9KVxuXG4gICAgY29uc3QgbW92ZVByZXZpb3VzU3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ21vdmUgUHJldmlvdXMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcm90YXRlS2V5cyxcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHN0ZXA6ICdtb3ZlUHJldmlvdXMnXG4gICAgICB9KSxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnXG4gICAgfSlcblxuICAgIGNvbnN0IG1vdmVDdXJyZW50U3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ21vdmUgQ3VycmVudCcsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiByb3RhdGVLZXlzLFxuICAgICAgcGF5bG9hZDogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgc3RlcDogJ21vdmVDdXJyZW50J1xuICAgICAgfSksXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJ1xuICAgIH0pXG5cbiAgICBjb25zdCBjcmVhdGVQZW5kaW5nU3RlcCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ2NyZWF0ZSBQZW5kaW5nJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHJvdGF0ZUtleXMsXG4gICAgICBwYXlsb2FkOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBzdGVwOiAnY3JlYXRlUGVuZGluZydcbiAgICAgIH0pLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCdcbiAgICB9KVxuXG4gICAgY29uc3QgZ2VuZXJhdGVBcnRpZmFjdHNTdGVwID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnZ2VuZXJhdGUgYXJ0aWZhY3RzJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHJvdGF0ZUtleXMsXG4gICAgICBwYXlsb2FkOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBzdGVwOiAnZ2VuZXJhdGVBcnRpZmFjdHMnXG4gICAgICB9KSxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnXG4gICAgfSlcblxuICAgIGNvbnN0IGpvYkZhaWxlZCA9IG5ldyBzZm4uRmFpbCh0aGlzLCAnRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdBV1MgQmF0Y2ggSm9iIEZhaWxlZCcsXG4gICAgICBlcnJvcjogJ0Rlc2NyaWJlSm9iIHJldHVybmVkIEZBSUxFRCdcbiAgICB9KVxuXG4gICAgY29uc3Qgam9iU3VjY2VzcyA9IG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnU3VjY2VzcyEnKVxuXG4gICAgZGVsZXRlUHJldmlvdXNTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG4gICAgbW92ZVByZXZpb3VzU3RlcC5hZGRDYXRjaChzbnNGYWlsKVxuICAgIG1vdmVDdXJyZW50U3RlcC5hZGRDYXRjaChzbnNGYWlsKVxuICAgIGNyZWF0ZVBlbmRpbmdTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG4gICAgZ2VuZXJhdGVBcnRpZmFjdHNTdGVwLmFkZENhdGNoKHNuc0ZhaWwpXG5cbiAgICAvLyBDcmVhdGUgY2hhaW5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gZGVsZXRlUHJldmlvdXNTdGVwXG4gICAgICAubmV4dChtb3ZlUHJldmlvdXNTdGVwKVxuICAgICAgLm5leHQobW92ZUN1cnJlbnRTdGVwKVxuICAgICAgLm5leHQoY3JlYXRlUGVuZGluZ1N0ZXApXG4gICAgICAubmV4dChnZW5lcmF0ZUFydGlmYWN0c1N0ZXApXG4gICAgICAubmV4dChqb2JTdWNjZXNzKVxuXG4gICAgc25zRmFpbC5uZXh0KGpvYkZhaWxlZClcblxuICAgIC8vIENyZWF0ZSBzdGF0ZSBtYWNoaW5lXG4gICAgY29uc3Qgcm90YXRlS2V5c01hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZSh0aGlzLCAnUm90YXRlS2V5cycsIHtcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShcbiAgICAgICAgZGVmaW5pdGlvblxuICAgICAgKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpXG4gICAgfSlcblxuICAgIHJvdGF0ZUtleXMuZ3JhbnRJbnZva2Uocm90YXRlS2V5c01hY2hpbmUucm9sZSlcbiAgICBvaWRjYnVja2V0LmdyYW50UmVhZFdyaXRlKHJvdGF0ZUtleXMpXG5cbiAgICBjb25zdCBzdGF0ZW1lbnRTaWduID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoKVxuICAgIHN0YXRlbWVudFNpZ24uYWRkQWN0aW9ucygna21zOionKVxuICAgIHN0YXRlbWVudFNpZ24uYWRkUmVzb3VyY2VzKCcqJylcbiAgICBjb25zdCBzaWduUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdTaWduUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW3N0YXRlbWVudFNpZ25dXG4gICAgfSlcbiAgICBzaWduUm9sZS5hZGRNYW5hZ2VkUG9saWN5KHNpZ25Qb2xpY3kpXG5cbiAgICBjb25zdCBzdGF0ZW1lbnRSb3RhdGVLZXlzID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoKVxuICAgIHN0YXRlbWVudFJvdGF0ZUtleXMuYWRkQWN0aW9ucygna21zOionKVxuICAgIHN0YXRlbWVudFJvdGF0ZUtleXMuYWRkUmVzb3VyY2VzKCcqJylcbiAgICBjb25zdCByb3RhdGVLZXlzUG9saWN5ID0gbmV3IGlhbS5NYW5hZ2VkUG9saWN5KHRoaXMsICdSb3RhdGVLZXlzUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW3N0YXRlbWVudFJvdGF0ZUtleXNdXG4gICAgfSlcbiAgICByb3RhdGVLZXlzUm9sZS5hZGRNYW5hZ2VkUG9saWN5KHJvdGF0ZUtleXNQb2xpY3kpXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tIEV2ZW50cyBSdWxlIERlZmluaXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICAvLyBSdW4gZXZlcnkgMyBtb250aHMgYXQgOCBQTSBVVENcbiAgICBjb25zdCBzY2hlZHVsZWRSb3RhdGVSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdzY2hlZHVsZWRSb3RhdGVSdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5leHByZXNzaW9uKCdjcm9uKDAgMjAgMSAqLzMgPyAqKScpXG4gICAgfSlcbiAgICBzY2hlZHVsZWRSb3RhdGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TZm5TdGF0ZU1hY2hpbmUocm90YXRlS2V5c01hY2hpbmUpKVxuXG4gICAgLy8gQ3JlYXRlIHN0YXRlIG1hY2hpbmUgYW5kIHRyaWdnZXIgdG8gcG9wdWxhdGUgaW5pdGlhbCBrZXlzXG4gICAgaWYgKCFwcm9wcy5kaXNhYmxlS2V5Um90YXRlT25DcmVhdGUpIHtcbiAgICAgIGNvbnN0IHJvdGF0ZU9uY2UgPSBuZXcgdGFza3MuU3RlcEZ1bmN0aW9uc1N0YXJ0RXhlY3V0aW9uKHRoaXMsICdyb3RhdGVPbmNlJywge1xuICAgICAgICBzdGF0ZU1hY2hpbmU6IHJvdGF0ZUtleXNNYWNoaW5lLFxuICAgICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHNmbi5JbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQlxuICAgICAgfSlcblxuICAgICAgY29uc3Qgcm90YXRlVHdpY2UgPSBuZXcgdGFza3MuU3RlcEZ1bmN0aW9uc1N0YXJ0RXhlY3V0aW9uKHRoaXMsICdyb3RhdGVUd2ljZScsIHtcbiAgICAgICAgc3RhdGVNYWNoaW5lOiByb3RhdGVLZXlzTWFjaGluZSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0JcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHBvcHVsYXRlS2V5cyA9IG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsICdwb3B1bGF0ZUtleXMnLCB7XG4gICAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShcbiAgICAgICAgICByb3RhdGVPbmNlLm5leHQocm90YXRlVHdpY2UpXG4gICAgICAgICksXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgaW5pdGlhbFJ1blJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ2luaXRpYWxSdW5SdWxlJywge1xuICAgICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgICBzb3VyY2U6IFsnYXdzLmNsb3VkZm9ybWF0aW9uJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbY2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrSWRdLFxuICAgICAgICAgIGRldGFpbFR5cGU6IFsnQ2xvdWRGb3JtYXRpb24gU3RhY2sgU3RhdHVzIENoYW5nZSddLFxuICAgICAgICAgIGRldGFpbDoge1xuICAgICAgICAgICAgJ3N0YXR1cy1kZXRhaWxzJzoge1xuICAgICAgICAgICAgICBzdGF0dXM6IFsnQ1JFQVRFX0NPTVBMRVRFJ11cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGluaXRpYWxSdW5SdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TZm5TdGF0ZU1hY2hpbmUocG9wdWxhdGVLZXlzKSlcbiAgICB9XG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBBUEkgR2F0ZXdheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgLy8gb25seSBzZXQgcG9saWN5IHdoZW4gb3JnSWQgaXMgc2V0XG4gICAgbGV0IGFwaVBvbGljeTogUG9saWN5RG9jdW1lbnQgfCB1bmRlZmluZWRcbiAgICBpZiAocHJvcHMub3JnSWQpIHtcbiAgICAgIGFwaVBvbGljeSA9IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpJbnZva2UnXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbXG4gICAgICAgICAgICAgIG5ldyBPcmdhbml6YXRpb25QcmluY2lwYWwocHJvcHMub3JnSWQpXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSlcbiAgICAgICAgXVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdBUElHYXRld2F5QWNjZXNzTG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogN1xuICAgIH0pXG5cbiAgICAvLyBDcmVhdGUgQVBJXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhUmVzdEFwaSh0aGlzLCAnandrLXN0cy1hcGknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1NUUyBUb2tlbiBBUEkgR2F0ZXdheScsXG4gICAgICBoYW5kbGVyOiBzaWduLFxuICAgICAgZGVmYXVsdE1ldGhvZE9wdGlvbnM6IHtcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNXG4gICAgICB9LFxuICAgICAgZW5kcG9pbnRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHR5cGVzOiBbYXBpZ2F0ZXdheS5FbmRwb2ludFR5cGUuUkVHSU9OQUxdXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBhcGlQb2xpY3ksXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIGxvZ2dpbmdMZXZlbDogTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKGxvZ0dyb3VwKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLSBSb3V0ZTUzIERlZmluaXRpb24gZm9yIGN1c3RvbSBkb21haW4gLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gICAgaWYgKHVzZUN1c3RvbURvbWFpbiAmJiBob3N0ZWRab25lKSB7XG4gICAgICBhcGkuYWRkRG9tYWluTmFtZSgnYXBpQ3VzdG9tRG9tYWluTmFtZScsIHtcbiAgICAgICAgZG9tYWluTmFtZTogdG9rZW5Eb21haW5OYW1lLFxuICAgICAgICBjZXJ0aWZpY2F0ZTogdG9rZW5DZXJ0aWZpY2F0ZSFcbiAgICAgIH0pXG5cbiAgICAgIC8vIEFkZCBBIHJlY29yZCBmb3IgY2xvdWRmcm9udCBkaXN0cmlidXRpb25cblxuICAgICAgbmV3IHJvdXRlNTMuQVJlY29yZCh0aGlzLCAnb2lkY1JlY29yZCcsIHtcbiAgICAgICAgcmVjb3JkTmFtZTogb2lkY0RvbWFpbk5hbWUsXG4gICAgICAgIHpvbmU6IGhvc3RlZFpvbmUsXG4gICAgICAgIHRhcmdldDogcm91dGU1My5SZWNvcmRUYXJnZXQuZnJvbUFsaWFzKG5ldyByb3V0ZTUzdGFyZ2V0cy5DbG91ZEZyb250VGFyZ2V0KGRpc3RyaWJ1dGlvbikpXG4gICAgICB9KVxuXG4gICAgICBuZXcgcm91dGU1My5BUmVjb3JkKHRoaXMsICd0b2tlblJlY29yZCcsIHtcbiAgICAgICAgcmVjb3JkTmFtZTogdG9rZW5Eb21haW5OYW1lLFxuICAgICAgICB6b25lOiBob3N0ZWRab25lLFxuICAgICAgICB0YXJnZXQ6IHJvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhuZXcgcm91dGU1M3RhcmdldHMuQXBpR2F0ZXdheShhcGkpKVxuICAgICAgfSlcblxuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ3Rva2VuRW5kcG9pbnQnLCB7XG4gICAgICAgIHZhbHVlOiAnaHR0cHM6Ly8nICsgdG9rZW5Eb21haW5OYW1lICsgJy90b2tlbicsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXJsIG9mIHRoZSB0b2tlbiBlbmRwb2ludCcsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0tdG9rZW5FbmRwb2ludGBcbiAgICAgIH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICd0b2tlbkVuZHBvaW50Jywge1xuICAgICAgICB2YWx1ZTogYXBpLnVybCArICd0b2tlbicsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXJsIG9mIHRoZSB0b2tlbiBlbmRwb2ludCcsXG4gICAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0tdG9rZW5FbmRwb2ludGBcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ2lzc3VlcicsIHtcbiAgICAgIHZhbHVlOiBpc3N1ZXIsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VybCBvZiB0aGUgaXNzdWVyJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke2Nkay5TdGFjay5vZih0aGlzKX0taXNzdWVyYFxuICAgIH0pXG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBXQUYgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuICAgIGlmIChwcm9wcy5hcGlHd1dhZiA9PT0gd2FmVXNhZ2UuQ29uc3RydWN0UHJvdmlkZWQpIHtcbiAgICAgIC8vIEFQSSBnYXRld2F5IFdBRiBBQ0wgYW5kIHJ1bGVzXG4gICAgICBjb25zdCBBUElHYXRld2F5V2ViQUNMID0gbmV3IHdhZnYyLkNmbldlYkFDTCh0aGlzLCAnQVBJR2F0ZXdheVdlYkFDTCcsIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIFdlYkFDTCBmb3IgQXV0aCBBUGkgR2F0ZXdheScsXG4gICAgICAgIHNjb3BlOiAnUkVHSU9OQUwnLFxuICAgICAgICBkZWZhdWx0QWN0aW9uOiB7IGFsbG93OiB7fSB9LFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgbWV0cmljTmFtZTogJ0FQSVdlYkFDTCcsXG4gICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnQVdTLUFXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIHZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0J1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHtcbiAgICAgICAgICAgICAgbm9uZToge31cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FXUy1BV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ0FXUy1BV1NNYW5hZ2VkUnVsZXNBbWF6b25JcFJlcHV0YXRpb25MaXN0JyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgICB2ZW5kb3JOYW1lOiAnQVdTJyxcbiAgICAgICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQW1hem9uSXBSZXB1dGF0aW9uTGlzdCdcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG92ZXJyaWRlQWN0aW9uOiB7XG4gICAgICAgICAgICAgIG5vbmU6IHt9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBV1MtQVdTTWFuYWdlZFJ1bGVzQW1hem9uSXBSZXB1dGF0aW9uTGlzdCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdhcGktZ3ctQXV0aEFQSUdlb0xvY2F0aW9uJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAzLFxuICAgICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXV0aEFQSUdlb0xvY2F0aW9uJyxcbiAgICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiBmYWxzZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBnZW9NYXRjaFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGNvdW50cnlDb2RlczogWydCWScsICdDTicsICdJUicsICdSVScsICdTWScsICdLUCddXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdhcGktZ3ctcmF0ZUxpbWl0UnVsZScsXG4gICAgICAgICAgICBwcmlvcml0eTogNCxcbiAgICAgICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcbiAgICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ3JhdGVMaW1pdFJ1bGUnLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IGZhbHNlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgICAgICAgbGltaXQ6IDEwMFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9KVxuXG4gICAgICAvLyBXZWIgQUNMIEFzc29jaWF0aW9uXG4gICAgICBuZXcgd2FmdjIuQ2ZuV2ViQUNMQXNzb2NpYXRpb24odGhpcywgJ0FQSUdhdGV3YXlXZWJBQ0xBc3NvY2lhdGlvbicsIHtcbiAgICAgICAgd2ViQWNsQXJuOiBBUElHYXRld2F5V2ViQUNMLmF0dHJBcm4sXG4gICAgICAgIHJlc291cmNlQXJuOiBhcGkuZGVwbG95bWVudFN0YWdlLnN0YWdlQXJuXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAocHJvcHMuYXBpR3dXYWYgPT09IHdhZlVzYWdlLlByb3ZpZGVXZWJBY2xBcm4gJiYgcHJvcHMuYXBpR3dXYWZXZWJBY2xBcm4pIHtcbiAgICAgIC8vIFdlYiBBQ0wgQXNzb2NpYXRpb25cbiAgICAgIG5ldyB3YWZ2Mi5DZm5XZWJBQ0xBc3NvY2lhdGlvbih0aGlzLCAnQVBJR2F0ZXdheVdlYkFDTEFzc29jaWF0aW9uJywge1xuICAgICAgICB3ZWJBY2xBcm46IHByb3BzLmFwaUd3V2FmV2ViQWNsQXJuLFxuICAgICAgICByZXNvdXJjZUFybjogYXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZUFyblxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvKiogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBDbG91ZHdhdGNoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnU3RlcEZ1bmN0aW9uRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUtleVJvdGF0aW9uU3RlcEZ1bmN0aW9uRmFpbGVkID8/ICdzdHMta2V5X3JvdGF0ZV9zZm4tYWxhcm0nLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBtZXRyaWM6IHJvdGF0ZUtleXNNYWNoaW5lLm1ldHJpY0ZhaWxlZCgpLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0tleSBSb3RhdGlvbiBGYWlsZWQnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSlcblxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGlHYXRld2F5NVhYQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUFwaUdhdGV3YXk1eHggPz8gJ3N0cy01eHhfYXBpX2d3LWFsYXJtJyxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgbWV0cmljOiBhcGkubWV0cmljU2VydmVyRXJyb3IoKSxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICc1eHggU1RTIEFQSSBnYXRld2F5IGZhaWx1cmVzJyxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IFRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pXG5cbiAgICBjb25zdCBzaWduRXJyb3JzID0gc2lnbi5tZXRyaWNFcnJvcnMoe1xuICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKVxuICAgIH0pXG5cbiAgICBjb25zdCByb3RhdGVFcnJvcnMgPSByb3RhdGVLZXlzLm1ldHJpY0Vycm9ycyh7XG4gICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpXG4gICAgfSlcblxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMYW1iZGFTaWduRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZVNpZ25MYW1iZGFGYWlsZWQgPz8gJ3N0cy1zaWduX2Vycm9yc19sYW1iZGEtYWxhcm0nLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBtZXRyaWM6IHNpZ25FcnJvcnMsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnU2lnbiBMYW1iZGEgRmFpbGVkJyxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IFRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pXG5cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhUm90YXRlRXJyb3InLCB7XG4gICAgICBhbGFybU5hbWU6IHByb3BzLmFsYXJtTmFtZUtleVJvdGF0aW9uTGFtYmRhRmFpbGVkID8/ICdzdHMta2V5X3JvdGF0ZV9lcnJvcnNfbGFtYmRhLWFsYXJtJyxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgbWV0cmljOiByb3RhdGVFcnJvcnMsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnS2V5IFJvdGF0aW9uIExhbWJkYSBGYWlsZWQnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSlcbiAgfVxufVxuIl19