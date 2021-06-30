import {
    APIGatewayProxyEvent,
    APIGatewayProxyResult
} from "aws-lambda";
import {
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    DeleteItemCommand,
    ScanCommand,
    UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

interface Ingredient {
    id: string;
    title: string;
    image?: string;
    calories: number;
    fat: number;
    carbohydrates: number;
}

interface IngredientParams {
    ingrId?: string
}

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    let body
    let statusCode = 200;
    const headers = {
        "Content-Type": "application/json"
    };
    console.log('event', JSON.stringify(event));

    const routeKey = `${event.httpMethod} ${event.resource}`
    try {
        switch (routeKey) {
            case "GET /ingredients":
                body = await getAllIngredients()
                break;
            case "GET /ingredients/{ingrId}":
                body = await getIngredient(event.pathParameters as { ingrId: string })
                break;

            default:
                throw new Error(`Unsupported route: "${routeKey}"`);
        }
    } catch (e) {
        console.error(e);
        statusCode = 500;
        body = {
            message: event.queryStringParameters,
            errorMsg: e.message,
            errorStack: e.stack,
        }
    } finally {
        body = JSON.stringify(body)
    }

    return {
        statusCode,
        body,
        headers
    }

}

const getAllIngredients = async () => {
    const dbClient = new DynamoDBClient({})
    let body;
    try {
        const { Items } = await dbClient.send(new ScanCommand({ TableName: process.env.INGRS_TABLE_NAME }));
        body = {
            message: "Successfully retrieved all ingredients.",
            data: Items?.map((item) => unmarshall(item)),
            Items,
        }
    } catch (e) {
        console.error(e);
        body = {
            message: "Failed to retrieve ingredients.",
            errorMsg: e.message,
            errorStack: e.stack,
        }
    }
    return body;
};


const getIngredient = async ({ ingrId }: IngredientParams) => {
    let body
    const dbClient = new DynamoDBClient({})
    try {
        const { Item } = await dbClient.send(new GetItemCommand({
            TableName: process.env.INGRS_TABLE_NAME,
            Key: marshall({ ingrId })
        }))
        body = {
            message: "Successfully retrieved ingredient.",
            data: Item ? unmarshall(Item) : {},
            rawData: Item,
        };
    } catch (e) {
        console.error(e);
        body = {
            message: "Failed to retrieve ingredient.",
            errorMsg: e.message,
            errorStack: e.stack,
        }
    }
    return body
}
