const AWS = require('aws-sdk');
const spoonApiKey = process.env.SPOON_API_KEY
// Define custom service spec to talk to spoonacular API
// make async calls without 3rd party library bloat
const service = new AWS.Service({
    endpoint: "https://api.spoonacular.com/",
    convertResponseTypes: false,
    apiConfig: {
        metadata: {
            protocol: 'rest-json'
        },
        operations: {
            queryAll: {
                http: {
                    method: 'GET',
                    requestUri: '/food/ingredients/search?query={q}&apiKey=' + spoonApiKey
                },
                input: {
                    type: 'structure',
                    required: [],
                    members: {
                        'q': {
                            type: 'string',
                            location: 'uri',
                            locationName: 'q'
                        }
                    }
                }
            },
            queryOne: {
                http: {
                    method: 'GET',
                    requestUri: '/food/ingredients/{id}/information?amount={amount}&unit={unit}&apiKey=' + spoonApiKey
                },
                input: {
                    type: 'structure',
                    required: ['id'],
                    members: {
                        'id': {
                            type: 'integer',
                            location: 'uri',
                            locationName: 'id'
                        },
                        'amount': {
                            type: 'integer',
                            location: 'uri',
                            locationName: 'amount'
                        },
                        'unit': {
                            type: 'string',
                            location: 'uri',
                            locationName: 'unit'
                        }
                    }
                }
            }
        }
    }
});
service.isGlobalEndpoint = true;

// handler makes calls based on url query params (id takes precedence)
// q returns list of ingredients based on string query (for typeahead)
// id returns full ingredient object
exports.handler = async (event, context, callback) => {

    async function doGet({ id, q }) {
        console.log('eventdata:', event);
        let promise = new Promise((resolve, reject) => {
            if (typeof id !== 'undefined') {
                service.queryOne({ id, amount: 100, unit: 'g' }, (err, data) => {
                    if (err) {
                        console.error(':>> operation error:', err);
                        callback(err);
                    }
                    console.log('data:', data);
                    resolve(spoonToIngr(data))
                });
            } else if (typeof q !== 'undefined') {
                service.queryAll({ q }, (err, data) => {
                    if (err) {
                        console.error(':>> operation error:', err);
                        callback(err);
                    }
                    console.log('data:', data);
                    resolve(data.results)
                });
            } else {
                callback("ERR: Must supply one of id or q parameters.");
            }
        })
        let result = await promise;
        return result;
    }

    const response = {
        statusCode: 200,
        body: JSON.stringify(await doGet(event.queryStringParameters)),
    };
    return response;
};

const spoonToIngr = ({ id, name, image, nutrition: { nutrients } }) => {
    return {
        spoonId: id,
        title: name,
        image,
        ..._queryNutrition(nutrients, 'carbohydrates'),
        ..._queryNutrition(nutrients, 'fat'),
        ..._queryNutrition(nutrients, 'calories')
    }
}

// helper function to get specific nutrient
const _queryNutrition = (arr, query) => {
    const matches = arr.filter((el) => {
        return el.name.toLowerCase() === query.toLowerCase()
    }).map(({ amount, unit }) => {
        var obj = {}
        obj[query] = { amount, unit }
        return obj
    })
    return matches.length > 0 ? matches[0] : {};
}