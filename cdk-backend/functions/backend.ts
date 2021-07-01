import {
    APIGatewayProxyEvent,
    APIGatewayProxyResult
} from "aws-lambda";
import * as AWS from 'aws-sdk';
const db = new AWS.DynamoDB.DocumentClient()
const TableName = process.env.INGRS_TABLE_NAME || 'IngredientsDynamoDbTable'

interface Ingredient {
    id: string;
    title: string;
    image?: string;
    calories: number;
    fat: number;
    carbohydrates: number;
}
interface IngredientParams {
    ingrId?: string;
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
            // case "POST /ingredients":
            //     if (!event.body) break;
            //     body = await createIngredient(
            //         typeof event.body == 'object' ? event.body : JSON.parse(event.body)
            //     )
            //     break;
            case "GET /ingredients/{ingrId}":
                body = await getIngredient(event.pathParameters as { ingrId: string })
                break;
            case "DELETE /ingredients/{ingrId}":
                body = await deleteIngredient(event.pathParameters as { ingrId: string })
                break;
            // case "PUT /ingredients/{ingrId}":
            //     if (!event.body) break;
            //     body = await updateIngredient(
            //         event.pathParameters as { ingrId: string },
            //         typeof event.body == 'object' ? event.body : JSON.parse(event.body)
            //     )
            //     break;
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
    let body;
    try {
        const { Items } = await db.scan({ TableName }).promise();
        body = Items
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
    try {
        const { Item } = await db.get({
            TableName,
            Key: { ['id']: ingrId }
        }).promise()
        body = Item
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

const deleteIngredient = async ({ ingrId }: IngredientParams) => {
    let body
    try {
        await db.delete({
            TableName,
            Key: { ['id']: ingrId }
        }).promise()
        body = ''
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

// const createIngredient = async ({ ingrId }: IngredientParams) => {
//     let body
//     try {
//         await db.delete({
//             TableName,
//             Key: { ['id']: ingrId }
//         }).promise()
//         body = ''
//     } catch (e) {
//         console.error(e);
//         body = {
//             message: "Failed to retrieve ingredient.",
//             errorMsg: e.message,
//             errorStack: e.stack,
//         }
//     }
//     return body
// }

// const updateIngredient = async ({ ingrId }: IngredientParams) => {
//     let body
//     try {
//         await db.delete({
//             TableName,
//             Key: { ['id']: ingrId }
//         }).promise()
//         body = ''
//     } catch (e) {
//         console.error(e);
//         body = {
//             message: "Failed to retrieve ingredient.",
//             errorMsg: e.message,
//             errorStack: e.stack,
//         }
//     }
//     return body
// }