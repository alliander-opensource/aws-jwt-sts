# Use IAM roles to authenticate principals in workloads outside of AWS using JWT
There is an inherent risk in maintaining and storing permanent credentials. In their lifetime, they are bound to be shared, compromised, and lost. When shared, it is often among a broader audience than initially intended. They can also be lost and found, sometimes by the wrong person. And when any of this occurs, it can put your systems, data or even organization at risk.

Workloads running on AWS can communicate with each other or with AWS services without the need of storing permanent credentials by assuming roles or instance profiles. However, if one of the workloads lives outside of AWS, AWS principals can no longer be used for authentication.

An alternative to authenticating with external workloads is to use short-lived credentials issued by a trusted party, the issuer, that the target system can accept. JWTs (JSON Web Tokens), as used by the OIDC (OpenID Connect) standard, are an example of such credentials. JWTs are short-lived credentials that can be signed and verified using a public key in what is known as public-key cryptography.

## Secure Token Service (STS)
Exchanging credentials from on form to the other is done with a Secure Token Service (STS) function. AWS also provides STS functions not the one we need. Only the other way around: to exchange a JWT to IAM Session which is called [AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html).
This repo contains a CDK Construct which will deploy a new function which adds the function to exchange an AWS IAM (Session) credential with a signed JWT. 

## Solution overview

The solution provides 2 endpoints; an OIDC discovery endpoint and a token endpoint. The OIDC discovery endpoint can be used to establish a trust between te STS function and a resource. The token endpoint can be used by client in AWS to exchange their IAM credentials to a JWT.

When a client wants to retrieve a JWT key, it will invoke the token API via the API GW. The backing lambda creates a JWT based on the invoking IAM identity and invokes KMS to sign the token. 

On time based events, EventBridge will trigger a Step function rotation flow. This flow triggers a lambda which in subsequent steps will create a new KMS signing key. Based on that signing key a JWKS is generated and stored in S3 together with discovery files. 

![Solution architecture](/doc/sts-jwt-function.drawio.png "Solution architecture")

## Using the construct

1.	Init a new typescript CDK project 
    `cdk init app --language typescript`
2.	Config npm to retrieve packages from github package repository
    `echo @alliander-opensource:registry=https://npm.pkg.github.com > .npmrc`
3.	Install the aws-jwt-sts construct
    `npm install @alliander-opensource/aws-jwt-sts`
4.	Edit lib/my-sts-stack.ts to add the construct to the stack
    See the comments in the code for possible options

```ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AwsJwtSts, wafUsage } from '@alliander-opensource/aws-jwt-sts'

export class MyStsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    new AwsJwtSts(this, 'sts', {
      /*
      * Mandatory:
      *
      * Set the default aud claim in the jwt, when not specified in the GET param
      */
      defaultAudience: 'api://resourceAudience',
    
      /*
      * Optional: when using a custom domain
      *
      * The construct can run on a custom domain, for this the following properties need to be added
      * Ensure a hosted zone is present in the account where the sts function will be deployed
      * Both needed to be set to use the custom domain
      */
      hostedZoneName: 'test.example.com', // domain name of the zone
      hostedZoneId: 'ZXXXXXXXXXXXXXXXXXXXX', // zoneId of the zone
    
      /*
      * Optional; when using a custom domain the subdomains of the endpoints can optionally be set
      */
      oidcSubdomain: 'oidc', // default 'oidc' for the discovery endpoint (cloudfront)
      tokenSubdomain: 'token', // default 'token' for the the token api gw endpoint
    
      /*
      * Optional:
      *
      * AWS WAF can be applied to the API GW
      * apiGwWaf acceptes the folling values:
      * wafUsage.ConstructProvided to use the WAF defined by the contruct
      * wafUsage.ProvideWebAclArn in combination with the apiGwWafWebAclArn param to specify an already deployed webAcl
      *
      * By not setting apiGwWaf, no WAF will be deployed
      */
      apiGwWaf: wafUsage.ProvideWebAclArn,
    
      /*
      * Optional; only applicable if apiGwWaf is set to: wafUsage.ProvideWebAclArn
      *
      * Specify the WebAcl to use for the API GW
      */
      apiGwWafWebAclArn: 'arn:aws:wafv2:{REGION}:{ACCOUNTID}:regional/webacl/{WebAclName}/{WebAclId}',
    
      /*
      * Optional:
      *
      * When used in a multi account structure with AWS Organizations specify the organization ID.
      * This sets a resource policy on the API GW Stage so that the whole org may access it
      * When not specified no policy is places on the API GW Stage and it will only allow access from within that account
      */
      orgId: 'o-xxxxxxxxxx'
    
    })
  }
}
```

5. Deploy the stack
   `cdk deploy`

The stack outputs the urls of the endpoints. So if no custom domain is provided observe the CDK Stack output.

## Using the STS function
A token from the STS function can be obained by invoking the token endpoint. 
`GET https://$host/token`
optionally an audience can be provided if this needs to be different than the installed default
`GET https://$host/token?aud=api://myAudience`

> Note: The IAM Role / User invoking the endpoint must have *execute-api:Invoke* permissions

In CDK these permission is added as followed:
```ts
role.addToPolicy(new iam.PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*']
    }))
```

> Note: keep in mind that *resource '\*'* should only be used if no other API GW's with IAM auth are used in that account.

### Test obtaining a JWT
1.	Ensure the AWS IAM Role / User invoking the token endpoint has execute-api permissions. If you are using administrator access then that is more than sufficient.
2.	Use a shell with AWS cli logged in, you can use your cli with which you deployed the stack or use cloudshell for this.
3.	Install awscurl for authentication
    `pip3 install awscurl`
4.	Install jwt-cli for jwt formatting
    `npm install -g jwt-cli`
5.	Invoke the api: `awscurl {your token endpoint}/token --service execute-api --region {your_region} | jq -r .token | jwt decode – `
6.	Observe the JWT
