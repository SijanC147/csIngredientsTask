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

import * as cdk from '@aws-cdk/core';

import { Runtime } from "@aws-cdk/aws-lambda";
import * as path from 'path';

export class CdkBackendStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reusable variable declerations 
    const {
      parentDomain,
      subs: [apiSubDomain, siteSubDomain, authSubDomain]
    } = { parentDomain: "seshat.app", subs: ['csapi', 'csingrs', 'csauth'] }

    // AWS SecretManager: Load secret values required for spinning up Infra
    let spoonApiKey = cdk.SecretValue.secretsManager('spoonacular', {
      jsonField: 'api-key',
    })
    let githubToken = cdk.SecretValue.secretsManager('github-access-token', {
      jsonField: 'github-token'
    })

    // AWS Route53: prepare hostedZone for using custom domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'csIngrsHostedZone', {
      domainName: parentDomain,
    });

    // AWS Certificate Manager: setup TLS certificate  
    const certificate = new acm.Certificate(this, "csIngrsCertificate", {
      domainName: parentDomain,
      subjectAlternativeNames: [`*.${parentDomain}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // AWS Cognito: Setup user pools, id pools and clients 
    // TODO figure out the auth flow without using aws client on FE
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
      redirectUri: `https://${siteSubDomain}.${parentDomain}`,
    })

    // AWS DynamoDB: Setup DynamoDB table for ingredients
    const table = new dynamodb.Table(this, "csIngrsTable", {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      tableName: "IngredientsDynamoDbTable",
    })

    // AWS Lambda: Setup lambda functions
    // SpoonLambda will proxy requests to spoonacular API
    const spoonLambda = new lambda.NodejsFunction(this, "csIngrsSpoonLambda", {
      functionName: "IngredientsSpoonProxyLambdaFn",
      runtime: Runtime.NODEJS_14_X,
      entry: path.join(__dirname, '../', 'functions', 'spoon.js'),
      environment: {
        SPOON_API_KEY: spoonApiKey as unknown as string
      }
    })
    // dynamoLambda handles CRUD ops on ingredients table
    const dynamoLambda = new lambda.NodejsFunction(this, "csIngrsLambdaHandler", {
      functionName: "IngredientsDynamoCRUDLambdaFn",
      runtime: Runtime.NODEJS_14_X,
      entry: path.join(__dirname, '../', 'functions', 'backend.ts'),
      environment: {
        INGRS_TABLE_NAME: table.tableName,
        INGRS_TABLE_REGION: this.region,
        SPOON_LAMBDA_NAME: spoonLambda.functionName,
        SPOON_LAMBDA_REGION: this.region,
      },
    });
    spoonLambda.grantInvoke(dynamoLambda); // let dynamoLambda call spoonLambda
    table.grantReadWriteData(dynamoLambda); // give table access to dynamoLambda

    // AWS APIGateway: Setup API endpoints for backend ops
    const dynamoLambdaIntegration = new apigw.LambdaIntegration(dynamoLambda)
    const spoonLambdaIntegeration = new apigw.LambdaIntegration(spoonLambda)
    const apiGateWay = new apigw.RestApi(this, "csIngrsRESTApi", {
      domainName: {
        domainName: `${apiSubDomain}.${parentDomain}`,
        certificate
      },
      defaultIntegration: dynamoLambdaIntegration,
      // ! Super loose, should be changed in production
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['*']
      },
    })

    const ingredients = apiGateWay.root.addResource('ingredients')
    ingredients.addMethod("ANY")
    const ingredient = ingredients.addResource('{ingrId}')
    ingredient.addMethod("ANY")
    // ingredients.addMethod("GET", dynamoLambdaIntegration)
    // ingredients.addMethod("POST", dynamoLambdaIntegration)

    // ingredient.addMethod("ANY", dynamoLambdaIntegration)

    const spoonSearch = ingredients.addResource('spoon', {
      defaultIntegration: spoonLambdaIntegeration
    })
    spoonSearch.addMethod('GET');

    // * Only used for testing authentication
    apiGateWay.root
      .resourceForPath('protected')
      .addMethod("GET", dynamoLambdaIntegration, { authorizer: auth });
    // ***********************************

    // AWS Route53: Add DNS entries for our API (csapi.seshat.app)
    new route53.ARecord(this, 'csIngrsApiAliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.ApiGateway(apiGateWay)),
      recordName: apiSubDomain
    });

    // AWS Route53: Add DNS entry for auth domain (csauth.seshat.app)
    new route53.ARecord(this, 'csIngrsAuthAliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.UserPoolDomainTarget(cognitoDomain)),
      recordName: authSubDomain
    });

    // AWS Amplify: Setup amplify app tied to repo containing frontend code
    // ? Separates logic for IaC and frontend dev - values injected through ENV at build
    const amplifyApp = new amplify.App(this, 'csIngrsClientApp', {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'SijanC147',
        repository: 'csIngredientsClient',
        oauthToken: githubToken
      }),
      customRules: [amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT],
      environmentVariables: {
        'IDENTITY_POOL_ID': identityPool.ref,
        'USER_POOL_ID': userPool.userPoolId,
        'USER_POOL_CLIENT_ID': userPoolClient.userPoolClientId,
        'API_ENDPOINT': apiGateWay.url.slice(0, apiGateWay.url.endsWith('/') ? -1 : apiGateWay.url.length),
        'REGION': this.region
      }
    });
    const masterBranch = amplifyApp.addBranch('master')
    const amplifyDomain = amplifyApp.addDomain(parentDomain)
    amplifyDomain.mapSubDomain(masterBranch, siteSubDomain)

  }
}
