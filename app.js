require('dotenv-extended').load()

var restify = require('restify')
var builder = require('botbuilder')
var rp = require('request-promise')

// Setup Restify server
var server = restify.createServer()
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url)
})

// Create Chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
})

var bot = new builder.UniversalBot(connector)
server.post('/api/messages', connector.listen())

var recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL)

// Bots Dialogs
bot.dialog('/', [
    function(session, args, next) {
        if (!session.userData.name) {
            session.beginDialog('/profile')
        } else {
            next()
        }
    },
    function(session, results) {
        session.beginDialog('/sayHi')
    }
])

// var intents = new builder.IntentDialog({ recognizers: [recognizer]})
// bot.dialog('/', intents)

// intents.matches('Search', [
//     function (session, args) {
//         var entity = args.entities[0].entity

//         switch (entity) {
//             case 'author':
//                 session.beginDialog('/Author')
//                 break
//             case 'paper':
//                 break
//             case 'field':
//                 break
//         }
//     }
// ])

bot.dialog('/Author', [
    function(session) {
        builder.Prompts.text(session, 'Type the name of the author: ')
    }, 
    function (session, results) {
        session.send('Searching for... %s', results.response)
        getInterpretation(session, results.response, 'author')
    }
])

bot.dialog('/profile', [
    function (session) {
        builder.Prompts.text(session, '¡Hola soy Theo! ¿Cuál es tu nombre?')
    },
    function (session, results) {
        session.userData.name = results.response
        session.endDialog()
    }
])

bot.dialog('/sayHi', [
    function (session) {
        session.send('¡Hola %s!', session.userData.name)
        session.replaceDialog('/askForSearch')
    }
])

bot.dialog('/sayGoodbye', [
    function (session) {
        session.send('¡Hasta la próxima %s!', session.userData.name)
        session.endDialog()
    }
])

bot.dialog('/askAnother', [
    function (session) {
        builder.Prompts.choice(session, '¿Quieres hacer otra busqueda?', ['Si', 'No'])
    },
    function (session, results) {
        var entity = results.response.entity
        switch (entity) {
            case 'Si':
                session.replaceDialog('/askForSearch')
                break
            case 'No':
                session.replaceDialog('/sayGoodbye')
                break
            default:
                session.replaceDialog('/sayGoodbye')
                break
        }
    }
])

bot.dialog('/askForSearch', [
    function (session) {
        builder.Prompts.choice(session, '¿Qué tipo de busqueda quieres realizar?', ['Por autor', 'Por título', 'Por palabras clave'])
    },
    function (session, results) {
        var entity = results.response.entity
        console.log(results.response)
        switch (entity) {
            case 'Por autor':
                session.replaceDialog('/author')
                break
            case 'Por título':
                session.replaceDialog('/field')
                break
            case 'Por palabras clave':
                session.replaceDialog('/field')
                break
            default:
                session.replaceDialog('/')
                break
        }
    }
])

bot.dialog('/author', [
    function (session) {
        builder.Prompts.text(session, '¿Cuál es el nombre del autor?')
    }, function (session, results) {
        session.send('Buscando resultados para... %s', results.response)
        getInterpretation(session, results.response, 'author')
    }
])

bot.dialog('/field', [
    function (session) {
        builder.Prompts.text(session, 'Ingresa las palabras clave: ')
    }, function (session, results) {
        session.send('Buscando resultados para... %s', results.response)
        getInterpretation(session, results.response, 'field')
    }
])

var authors_expr

bot.dialog('/selectAuthor', [
    function (session, authors_names) {
        builder.Prompts.choice(session, 'De acuerdo con la base de datos estos autores coinciden con tu busqueda, selecciona uno: ', authors_names)
    }, 
    function (session, results) {
        var entity = results.response.entity
        var expr = authors_expr[results.response.index]//'Composite(AA.AuN==\'' + entity + '\')'
        getPapers(session, expr)
    }
])

var keywords_expr

bot.dialog('/selectKeyword', [
    function (session, keywords) {
        builder.Prompts.choice(session, 'De acuerdo con la base de datos los siguientes resultados coinciden con tu busqueda, selecciona uno: ', keywords)
    }, 
    function (session, results) {
        var entity = results.response.entity
        var expr = keywords_expr[results.response.index]//'Composite(AA.AuN==\'' + entity + '\')'
        getPapers(session, expr)
    }
])

function getInterpretation(session, query, type) {
    var options = {
        uri: 'https://westus.api.cognitive.microsoft.com/academic/v1.0/interpret?query=' + query.toLowerCase() + '&complete=1&count=10000',
        headers: {
            'User-Agent': 'Request-Promise',
            'Ocp-Apim-Subscription-Key': process.env.OCP_APIM_SUBSCRIPTION_KEY
        },
        json: true // Automatically parses the JSON string in the response
    }

    rp(options)
        .then(function (response) {
            var interpretations = response.interpretations

            if (type === 'author') {
                var filtered = interpretations.filter(function(inter) {
                    return inter.rules[0].output.value.includes('AA.AuN')
                })

                var authors_names = []
                authors_expr = []
                
                filtered.forEach(function (element) {
                    var rules = element.rules

                    rules.forEach(function(rule) {
                        var value = rule.output.value
                        if (value.includes('And')) {
                            var values = value.split(',')
                            var author = ''
                            values.forEach(function(val) {
                                author += ' ' + val.match(/'([^']+)'/)[1]
                            })
                            authors_names.push(author)
                        } else {
                            var author = rule.output.value.match(/'([^']+)'/)[1]
                            authors_names.push(author)
                        }

                        authors_expr.push(value)
                    })    
                });

                session.replaceDialog('/selectAuthor', authors_names)

            } else if (type === 'field') {
                var filtered = interpretations.filter(function(inter) {
                    return inter.rules[0].output.value.includes('Ti')
                })

                var keywords = []
                keywords_expr = []

                filtered.forEach(function (element) {
                    var rules = element.rules

                    rules.forEach(function(rule) {
                        var value = rule.output.value
                        if (value.includes('And')) {
                            var values = value.split(',')
                            var keyword = ''
                            values.forEach(function(val) {
                                keyword += ' ' + val.match(/'([^']+)'/)[1]
                            })
                            keywords.push(keyword)
                        } else {
                            var keyword = rule.output.value.match(/'([^']+)'/)[1]
                            keywords.push(keyword)
                        }

                        keywords_expr.push(value)
                    })    
                });

                session.replaceDialog('/selectKeyword', keywords)
            
            } else if (type === 'field') {
                var filtered = interpretations.filter(function(inter) {
                    return inter.rules[0].output.value.includes('F.FN') || inter.rules[0].output.value.includes('AA.AuN')
                })

                var keywords = []
                keywords_expr = []

                filtered.forEach(function (element) {
                    var rules = element.rules

                    rules.forEach(function(rule) {
                        var value = rule.output.value
                        if (value.includes('And')) {
                            var values = value.split(',')
                            var keyword = ''
                            values.forEach(function(val) {
                                keyword += ' ' + val.match(/'([^']+)'/)[1]
                            })
                            keywords.push(keyword)
                        } else {
                            var keyword = rule.output.value.match(/'([^']+)'/)[1]
                            keywords.push(keyword)
                        }

                        keywords_expr.push(value)
                    })    
                });

                session.replaceDialog('/selectKeyword', keywords)
            
            }
            
        })
        .catch(function (err) {
            console.log(err.error)
        })
}

function getPapers(session, expr) {
    var options = {
        uri: 'https://westus.api.cognitive.microsoft.com/academic/v1.0/evaluate?expr=' + expr + '&count=10000&attributes=Ti,Y,CC,AA.AuN,AA.AuId,J.JN,E',
        headers: {
            'User-Agent': 'Request-Promise',
            'Ocp-Apim-Subscription-Key': process.env.OCP_APIM_SUBSCRIPTION_KEY
        },
        json: true // Automatically parses the JSON string in the response
    }

    rp(options)
        .then(function (response) {
            // console.log(response)
            session.send('Se encontraron %s papers', response.entities.length)
            var entities = response.entities
            var cards = []

            entities.forEach(function (entity) {
                try {
                    var data = JSON.parse(entity.E)
                    console.log(data.VFN)
                    var card = new builder.HeroCard(session)
                                .title(data.DN)//(data.DN === null || data.DN === 'undefined') ? 'not available' : data.DN)
                                .subtitle(data.VFN)//(data.VFN === null || data.VFN === 'undefined') ? 'not available' : data.VFN)
                                .text(data.D)//(data.D === null || data.D === 'undefined') ? 'not available' : data.D)
                                .buttons([
                                    builder.CardAction.openUrl(session, (data.S[0].U === null || data.S[0].U === 'undefined') ? 'https://www.google.com/' : data.S[0].U, 'Ver')
                                ])
                    
                    cards.push(card)
                    console.log(cards.length)
                } catch (err) {
                    console.log(err)
                }
            })

            var reply = new builder.Message(session)
                .attachmentLayout(builder.AttachmentLayout.carousel)
                .attachments(cards)

            session.send(reply)
        })
        .catch(function (err) {
            console.log(err.error)
        })
}
