import * as s3Deploy from '@aws-cdk/aws-s3-deployment';
import * as s3 from '@aws-cdk/aws-s3';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as lambda from "@aws-cdk/aws-lambda-nodejs";
import * as apigw from "@aws-cdk/aws-apigateway";
import * as cognito from "@aws-cdk/aws-cognito";
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as amplify from '@aws-cdk/aws-amplify';
import * as codebuild from '@aws-cdk/aws-codebuild';

import * as cdk from '@aws-cdk/core';

import { Runtime } from "@aws-cdk/aws-lambda";
import * as path from 'path';

export class CdkBackendStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // define once for reuse
    const {
      parentDomain,
      subs: [apiSubDomain, siteSubDomain, authSubDomain]
    } = { parentDomain: "seshat.app", subs: ['csapi', 'csingrs', 'csauth'] }
    // prepare hostedZone for using custom domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'csIngrsHostedZone', {
      domainName: parentDomain,
    });
    // TLS certificate
    const certificate = new acm.Certificate(this, "csIngrsCertificate", {
      domainName: parentDomain,
      subjectAlternativeNames: [`*.${parentDomain}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create Cognito user pool for authentication
    const userPool = new cognito.UserPool(this, 'csIngrsUserPool', {
      userPoolName: 'cs-ingrs-userpool',
      signInAliases: { email: true },
    })
    const userPoolClient = userPool.addClient('Client', {
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [`https://${siteSubDomain}.${parentDomain}/welcome`],
        logoutUrls: [`https://${siteSubDomain}.${parentDomain}/signin`],
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    const identityPool = new cognito.CfnIdentityPool(this, 'csIngrsIdentityPool', {
      allowUnauthenticatedIdentities: true,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName
        }
      ]
    })
    const cognitoDomain = userPool.addDomain('csIngrsCognitoDomain', {
      customDomain: {
        domainName: `${authSubDomain}.${parentDomain}`,
        certificate,
      },
    });
    const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'csIngrsAuthorizer', {
      cognitoUserPools: [userPool]
    })
    const signInUrl = cognitoDomain.signInUrl(userPoolClient, {
      redirectUri: `https://${siteSubDomain}.${parentDomain}/welcome`,
    })

    // dynamodb
    const table = new dynamodb.Table(this, "csIngrsTable", {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }
    })

    // NodeJS lambda function
    const dynamoLambda = new lambda.NodejsFunction(this, "csIngrsLambdaHandler", {
      runtime: Runtime.NODEJS_14_X,
      entry: path.join(__dirname, '../', 'functions', 'backend.ts'),
      handler: "lambdaHandler",
      environment: {
        INGRS_TABLE_NAME: table.tableName,
      },
    });
    table.grantReadWriteData(dynamoLambda);

    // apigateway
    const api = new apigw.LambdaRestApi(this, "csIngrsRESTApi", {
      handler: dynamoLambda,
      proxy: false,
      domainName: {
        domainName: `${apiSubDomain}.${parentDomain}`,
        certificate
      }
    })
    const ingredients = api.root.addResource('ingredients', {
      defaultMethodOptions: {
        authorizer: auth,
        authorizationType: apigw.AuthorizationType.COGNITO
      }
    })
    ingredients.addMethod('GET')
    const ingredient = ingredients.addResource('ingredient')
    ingredient.addMethod('GET')
    ingredient.addMethod('POST')
    ingredient.addMethod('PATCH')
    ingredient.addMethod('DELETE')

    // const deploymentBucket = new s3.Bucket(this, "csIngrsDeploymentBucket", {
    //   bucketName: `${siteSubDomain}.${parentDomain}`,
    //   publicReadAccess: true,
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    //   websiteIndexDocument: "index.html"
    // });
    // const distribution = new cloudfront.Distribution(this, 'csIngrsCloudFrontDistribution', {
    //   defaultBehavior: {
    //     origin: new origins.S3Origin(deploymentBucket)
    //   },
    //   domainNames: [`${siteSubDomain}.${parentDomain}`],
    //   certificate
    // });

    // Deployment
    // const src = new s3Deploy.BucketDeployment(this, "csIngrsDeployment", {
    //   sources: [
    //     // s3Deploy.Source.asset(path.join(__dirname, '../', '../', "dist", "csIngredientsClient.zip"))
    //     // s3Deploy.Source.asset(path.join(__dirname, '../', '../', "dist", "csIngredientsTask"))
    //   ],
    //   destinationBucket: deploymentBucket,
    //   distribution,
    //   distributionPaths: ["/*"]
    // });

    // new route53.ARecord(this, 'csIngrsSiteAliasRecord', {
    //   zone: hostedZone,
    //   target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    //   recordName: siteSubDomain
    // })

    new route53.ARecord(this, 'csIngrsApiAliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.ApiGateway(api)),
      recordName: apiSubDomain
    });

    new route53.ARecord(this, 'csIngrsAuthAliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.UserPoolDomainTarget(cognitoDomain)),
      recordName: authSubDomain
    });

    const amplifyApp = new amplify.App(this, 'csIngrsClientApp', {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'SijanC147',
        repository: 'csIngredientsClient',
        oauthToken: cdk.SecretValue.secretsManager('github-access-token', {
          jsonField: 'github-token'
        })
      }),
      customRules: [amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT],
    });
    const masterBranch = amplifyApp.addBranch('master')
    const amplifyDomain = amplifyApp.addDomain(parentDomain)
    amplifyDomain.mapSubDomain(masterBranch, siteSubDomain)

  }
}
