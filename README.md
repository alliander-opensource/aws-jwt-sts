# AWS STS & JWK
In order to have systems from different ecosystems like AWS and Azure communicating with each other some form of 
authentication is needed. A well known way to do so is by means of a JWT token.

 Unfortunately, there is no out-of-the-box solution within AWS to get a JWT token from an IAM role. Therefore, we chose 
 to build a custom solution for now. (An PFR has already been filed with AWS) More information can be found 
 [here](https://alliander.atlassian.net/wiki/spaces/CL/pages/3234300685/Aws+Role+to+JWT+STS+function).

## AWS (CDK)

The AWS folder contains the infrastructure to deploy all needed resources, including:
- S3
- Cloudfront
- Stepfunctions
- EventBridge
- Lambda

To build and deploy the CDK infrastructure:
* `npm run build`   compile typescript to js
* `cdk deploy`      deploy this stack to your default AWS account/region

## Lambda

The Lambda folder contains the typescript functions that are being deployed as AWS Lambda's. These lambdas are part of 
the statemachine defined in the AWS folder
