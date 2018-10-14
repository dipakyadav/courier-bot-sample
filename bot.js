// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// bot.js is your bot's main entry point to handle incoming activities.

const { ActivityTypes } = require('botbuilder');
const { DialogSet, TextPrompt, NumberPrompt, ChoicePrompt, DateTimePrompt, WaterfallDialog } = require('botbuilder-dialogs');
var sqlite3 = require('sqlite3');
var moment = require('moment');


function validateEmail(email) {
    var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

// Sqlite3 schema
// CREATE TABLE "customers" ( `CustomerID` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, `EmailID` TEXT NOT NULL UNIQUE )
/*
CREATE TABLE "orders" ( `OrderID` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 `CustomerID` INTEGER,
 `OriginAddress` TEXT,
 `DestinationAddress` TEXT,
 `ItemType` TEXT,
 `ItemCount` INTEGER,
 `ItemTotalWeight` INTEGER,
 `PickupWindowTimeX` TEXT,
 `PickupWindowType` TEXT,
 `PickupWindowValue` TEXT,
 `PickupWindowStart` TEXT,
 `PickupWindowEnd` TEXT,
 `Instructions` TEXT,
 `ReceivingWindowTimeX` TEXT,
 `ReceivingWindowType` TEXT,
 `ReceivingWindowValue` TEXT,
 `ReceivingWindowStart` TEXT,
 `ReceivingWindowEnd` TEXT,
 `CreatedDate` INTEGER,
 FOREIGN KEY(`CustomerID`) REFERENCES `customers`(`CustomerID`) )
*/

var db = new sqlite3.Database('./db/courier.db', (err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Connected to the courier  tracking database.');
});


db.getAsync = function (sql, params) {
    var that = this;
    return new Promise(function (resolve, reject) {
        that.get(sql, params, function (err, row) {
            if (err)
                reject(err);
            else
                resolve(row);
        });
    });
};

db.runAsync = function (sql, params) {
    var that = this;
    return new Promise(function (resolve, reject) {
        that.run(sql, params, function (err, row) {
            if (err)
                reject(err);
            else
                resolve(row);
        });
    });
};

db.allAsync = function(sql, params) {
    var that = this;
    return new Promise(function (resolve, reject) {
        that.all(sql, params, function (err, rows) {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
};

async function getCustomerByID(customerID) {
    
    var row =  await  db.getAsync("select * from customers where CustomerID = ?", [customerID]);
    return row;
}

async function getCustomerByEmailID(emailID) {
    var row = await db.getAsync("select * from customers where EmailID=?", [emailID]);
    return row;
}

async function registerCustomerByEmail(emailID) {
    var res = await db.runAsync("insert into customers (EmailID) values(?)", [emailID]);
    return res;
}

async function recordCourierBookingInfo(customer, courier) {
    
    
    var params = [
        customer["number"], courier["originAddress"], courier["destinationAddress"], courier["itemType"],
        courier["itemCount"], courier["itemTotalWeight"], courier["pickupWindow"]["timex"],
        courier["pickupWindow"]["type"]
    ];
    
    var insQueryColumns = [
        'CustomerID', 'OriginAddress', 'DestinationAddress', 'ItemType', 'ItemCount', 'ItemTotalWeight',
        'PickupWindowTimeX', 'PickupWindowType'
    ];

    var valuePlaceHolder = ['?', '?', '?', '?', '?', '?', '?', '?', ];

    if ('value' in courier["pickupWindow"]) {
        insQueryColumns.push("PickupWindowValue");
        params.push(courier["pickupWindow"]["value"]);
        valuePlaceHolder.push('?');
    }
    if ('start' in courier["pickupWindow"]) {
        insQueryColumns.push("PickupWindowStart");
        params.push(courier["pickupWindow"]["start"]);
        valuePlaceHolder.push('?');
    }
    if ('end' in courier["pickupWindow"]) {
        insQueryColumns.push("PickupWindowEnd");
        params.push(courier["pickupWindow"]["end"]);
        valuePlaceHolder.push('?');
    }

    insQueryColumns.push("Instructions", "ReceivingWindowTimeX", "ReceivingWindowType");
    params.push(courier["instructions"], courier["receivingWindow"]["timex"], courier["receivingWindow"]["type"]);
    valuePlaceHolder.push('?', '?', '?');

    if ('value' in courier["receivingWindow"]) {
        insQueryColumns.push("ReceivingWindowValue");
        params.push(courier["receivingWindow"]["value"]);
        valuePlaceHolder.push('?');
    }
    if ('start' in courier["receivingWindow"]) {
        insQueryColumns.push("ReceivingWindowStart");
        params.push(courier["receivingWindow"]["start"]);
        valuePlaceHolder.push('?');
    }
    if ('end' in courier["receivingWindow"]) {
        insQueryColumns.push("ReceivingWindowEnd");
        params.push(courier["receivingWindow"]["end"]);
        valuePlaceHolder.push('?');
    }


    var insQuery = [
        "insert into orders (",
        insQueryColumns.join(', '),
        ") ",
        "values(",
        valuePlaceHolder.join(', '),
        ")"
    ];

    // console.log("insQueryColumnsLength:" + insQueryColumns.length, insQuery.join(''));
    // console.log("paramsLenght" + params.length, params);
    
    var res = await db.runAsync(insQuery.join(''), params);
    return res;
}

async function getLastOrderByCustomerID(customerID) {
    var row = await db.getAsync("select OrderID from orders where CustomerID=? order by OrderID desc limit 1", [customerID]);
    return row;
}

async function getAllCustomerOrdersByOrderID(customerID, orderIDs) {

    orderIDs = orderIDs.split(',');
    orderIDs = orderIDs.map(Function.prototype.call, String.prototype.trim);
    orderIDs = orderIDs.join("','")

    // console.log("select * from orders where CustomerID="+ customerID +" and OrderID in('"+ orderIDs +"')");

    // getting Error: SQLITE_RANGE: column index out of range, with below query
    // var row = await db.allAsync("select * from orders where CustomerID=? and OrderID in('?')", [customerID, orderIDs]);
    var rows = await db.allAsync("select * from orders where CustomerID="+ customerID +" and OrderID in('"+ orderIDs +"')", []);
    // console.log(rows);
    return rows;
}


class EchoBot {
    /**
     *
     * @param {ConversationState} conversation state object
     * @param {DialogSet} dialogSet state object
     */
    constructor(conversationState, dialogSet) {
        // Creates a new state accessor property.
        // See https://aka.ms/about-bot-state-accessors to learn more about the bot state and state accessors
        
        this.conversationState = conversationState;
        this.dialogSet = dialogSet;

        
        this.dialogSet.add(new TextPrompt('textPrompt'));
        this.dialogSet.add(new ChoicePrompt('choicePrompt'));
        this.dialogSet.add(new NumberPrompt('numberPrompt'));

        this.dialogSet.add(new NumberPrompt('customerNumberPrompt', async(promptContext) => {
            if (promptContext.recognized.succeeded) {
                const value = promptContext.recognized.value;
                
                try {
                    if (value < 1000) {
                        throw new Error('Customer Number doesn\'t exist');
                    } else {
                        var row = await getCustomerByID(value);
                        if (!row) {
                            throw new Error('Customer Number doesn\'t exist');
                        }

                        // Change to customer object from sqlite
                        promptContext.recognized.value = row;

                        return true; // Indicate that this is a valid value.
                    }
                } catch (err) {
                    await promptContext.context.sendActivity(`${ err.message } <br/>Please provide a valid Customer Number.`);
                    return false; // Indicate that this is invalid.
                }
            } else {
                return false;
            }
        }));
        
        this.dialogSet.add(new TextPrompt('emailPrompt', async (promptContext) => {
            if (promptContext.recognized.succeeded) {
                const value = promptContext.recognized.value;
                
                try {
                    if (!validateEmail(value)) {
                        throw new Error('Invalid Email address');
                    } else {
                        return true; // Indicate that this is a valid value.
                    }
                } catch (err) {
                    await promptContext.context.sendActivity(`${ err.message } <br/>Please provide a valid email address.`);
                    return false; // Indicate that this is invalid.
                }
            } else {
                return false;
            }
        }));

        // this.dialogSet.add(new DateTimePrompt('dateTimePrompt'));
        this.dialogSet.add(new DateTimePrompt('dateTimePrompt', async (promptContext) => {
            
            if (promptContext.recognized.succeeded) {
                const values = promptContext.recognized.value;
                try {
                    if (values.length < 0) { throw new Error('missing time') }
                    const value = new Date(values[0].value);
                    
                    if (value.getTime() < new Date().getTime()) { throw new Error('in the past') }
        
                    // update the return value of the prompt to be a real date object
                    // promptContext.recognized.value = value;
                    return true; // indicate valid 
                } catch (err) {
                    await promptContext.context.sendActivity(`Please enter a valid time in the future like "tomorrow at 9am".`);
                    return false; // indicate invalid
                }
            } else {
                await promptContext.context.sendActivity(`Please enter a valid time in the future like "tomorrow at 9am".`);
                return false; // indicate invalid
            }
        }));


        this.dialogSet.add(new WaterfallDialog('mainMenu', [
            async function (step) {
                // Welcome the user and send a prompt.
                // await step.context.sendActivity("'Hello Welcome to courier  Booking and Tracking bot.'");
                return await step.prompt('choicePrompt', "What would you like to do?", ['Book a courier', 'Check courier status']);
            },
            async function (step) {
                // Handle the user's response to the previous prompt and branch the dialog.
                if (step.result.value.match(/book Book a courier/ig)){
                    return await step.beginDialog('bookCourier');
                } else if (step.result.value.match(/Check courier status/ig)) {
                    return await step.beginDialog('checkCourierStatus');
                }
            },
            async function (step) {
                // Calling replaceDialog will loop the main menu
                return await step.replaceDialog('mainMenu');
            }
        ]));

        this.dialogSet.add(new WaterfallDialog('bookCourier', [
            async function (step) {
                /*
                return await step.beginDialog('bookPrompt', step.values.orderCart = {
                    orders: [],
                    total: 0
                }); // Prompt for orders
                */
               step.values.bookCourier = {customer:{}, courier:{}};
               await step.context.sendActivity('Sure, I can help you with that.\nCan you please identify yourself?');
               return await step.prompt("choicePrompt", "Are you an existing customer?", ["Yes", "No"]);
            },
            async function (step) {
                if (step.result.value.match(/yes/ig)) {

                    step.values.bookCourier.customer["isExisting"] = true;
                    return await step.prompt('customerNumberPrompt', "Great, what’s your Customer Number");
                
                } else if (step.result.value.match(/no/ig)) {
                
                    // await step.context.sendActivity('Should we register this customer?');
                    step.values.bookCourier.customer['isExisting'] = false;
                    return step.next();

                }
            },
            async function (step) {
                // console.log(step.result.value);
                step.values.bookCourier.customer['number'] = "";
                if (step.values.bookCourier.customer['isExisting'] === true) {

                    // var row = await getCustomerByID(step.result);
                    // console.log("step.customernumber.result", step.result);

                    step.values.bookCourier.customer['number'] = step.result.CustomerID;
                    step.values.bookCourier.customer['email'] = step.result.EmailID;
                    return step.next();
                }
                // console.log(step.values);
                return await step.prompt('emailPrompt', "Can you confirm your email address?");
                
            },
            async function (step) {
                if (step.values.bookCourier.customer['isExisting'] === false) {
                    // Check if email address is already registered with us.
                    var row = await getCustomerByEmailID(step.result);
                    if (row) {
                        await step.context.sendActivity(`This Email address is already registered with us,\n for your future reference customer number associated with this email address is : ${row.CustomerID}`);
                        step.values.bookCourier.customer['number'] = row.CustomerID;
                        step.values.bookCourier.customer['email'] = row.EmailID;
                        step.values.bookCourier.customer['isExisting'] = true;
                    } else {
                        await step.context.sendActivity('We are registering you, Please wait..');
                        // save email in to db and generate a customerID
                        var resp = await registerCustomerByEmail(step.result);
                        // console.log(resp);
                        if(!resp) {
                            var row = await getCustomerByEmailID(step.result);
                            step.context.sendActivity(`Your registration was successfull with us, your customer number is : ${row.CustomerID}`);
                            step.values.bookCourier.customer['number'] = row.CustomerID;
                            step.values.bookCourier.customer['email'] = row.EmailID;
                            step.values.bookCourier.customer['isExisting'] = true;
                        } else {
                            await step.context.sendActivity(`Something went wrong!!\n
                            We were unable to register you, please try after sometime!!\n
                            If still doesn't work, please contact support`);
                            return await step.endDialog();
                        }
                    }
                }

                // step.values.bookCourier['customerEmail'] = step.result;
                // console.log(step.values);
                return await step.prompt('textPrompt', "What would be the Origin address?");
            },
            async function (step) {
                step.values.bookCourier.courier['originAddress'] = step.result;
                // console.log(step.values);
                return await step.prompt('dateTimePrompt', "Do you have a pickup window?");
            },
            async function (step) {
                console.log("pickup window", step.result);
                // console.log(step.result.value);
                step.values.bookCourier.courier['pickupWindow'] = step.result[0];
                // console.log(step.values);
                return await step.prompt('textPrompt', "What would be the destination address? OR\nWhere would this be going");
            },
            async function (step) {
                step.values.bookCourier.courier['destinationAddress'] = step.result;
                // console.log(step.values);
                return await step.prompt('dateTimePrompt', "Do you have a receiving window?");
            },
            async function (step) {
                console.log("receiving window", step.result);
                // console.log(step.result.value);
                step.values.bookCourier.courier['receivingWindow'] = step.result[step.result.length - 1];
                // console.log(step.values);
                return await step.prompt('choicePrompt', "What are you shipping (pallets, carton)", ["pallets", "carton"]);
            },
            async function (step) {
                step.values.bookCourier.courier['itemType'] = step.result.value;
                // console.log(step.values);
                return await step.prompt('numberPrompt', "How many?");
            },
            async function (step) {
                step.values.bookCourier.courier['itemCount'] = step.result;
                // console.log(step.values);
                return await step.prompt('numberPrompt', "What’s the total weight");
            },
            async function (step) {
                step.values.bookCourier.courier['itemTotalWeight'] = step.result;
                // console.log(step.values);
                return await step.prompt('textPrompt', "Any special instructions");
            },
            async function (step) {
                step.values.bookCourier.courier['instructions'] = step.result;

                // Save the courier shipping item in database.
                var res = await recordCourierBookingInfo(step.values.bookCourier.customer, step.values.bookCourier.courier);
                if (!res) {
                    step.context.sendActivity("Your courier shipping item was successfully booked!");
                    // get the order number 
                    var row = await getLastOrderByCustomerID(step.values.bookCourier.customer["number"]);
                    step.context.sendActivity(`Your courier shipping order number is: ${row.OrderID}`);
                    // return await step.endDialog();

                } else {
                    await step.context.sendActivity(`Something went wrong!! (: \n
                        We were unable to process your request, please try after sometime!!\n
                        If still doesn't work, please contact support`);
                        // return await step.endDialog();
                }
                return await step.endDialog();
            }
        ]));


        this.dialogSet.add(new WaterfallDialog('checkCourierStatus', [
            async function (step) {
                step.values.checkCourierStatus = {};
                await step.context.sendActivity('Sure, I can help you with that');
                return await step.prompt('textPrompt', 'Do you have an order number, you can also paste comma separated, multiple orders here');
            },
            async function (step) {
                step.values.checkCourierStatus["orderIDs"] = step.result;
                return await step.prompt('textPrompt', 'Great, What is your Customer ID');
            },
            async function (step) {
                step.values.checkCourierStatus["CustomerID"] = step.result;
                await step.context.sendActivity("Please wait.., we are fetching your order status");
                var rows = await getAllCustomerOrdersByOrderID(step.values.checkCourierStatus["CustomerID"], step.values.checkCourierStatus["orderIDs"]);
                // console.log(rows.length);
                if (rows) {
                    // show orders with status
                    await step.context.sendActivity('Below is/are your orders');
                    // console.log(rows);
                    
                    for(var row in rows) {

                        var orderRow = rows[row];
                        
                        // console.log(typeof orderRow.ReceivingWindowValue);
                        // console.log(typeof orderRow.ReceivingWindowEnd);

                        var msgStatusList = [
                            ' was dispatched and is on time.\n',
                            [
                                ' is scheduled to be dispatched on ',
                                orderRow.PickupWindowEnd != null ? orderRow.PickupWindowEnd : orderRow.PickupWindowValue,
                                '\n'
                            ].join(''),
                            ' was picked up and is on time.\n',
                            [
                                'is scheduled to be picked up on ',
                                orderRow.PickupWindowValue != null ? orderRow.PickupWindowValue : orderRow.PickupWindowEnd,
                            ].join('')
                        ];
                        // , receiveDateTime = orderRow.ReceivingWindowValue != null ? orderRow.ReceivingWindowValue.toString().split(' ') : orderRow.ReceivingWindowEnd.toString().split(' ');
                        

                        await step.context.sendActivity(
                            [
                                'Your Order from ', orderRow.OriginAddress, ' to ', orderRow.DestinationAddress,
                                msgStatusList[Math.floor(Math.random() * (+msgStatusList.lenght - +0)) + +0],
                                '.\nIt is scheduled to arrive at the destination ',
                                // receiveDateTime[0],
                                // receiveDateTime.length > 1 ? ' by ' + receiveDateTime[1]: '',
                                moment(orderRow.ReceivingWindowValue != null ? orderRow.ReceivingWindowValue : orderRow.ReceivingWindowEnd).calendar().replace("at", "by")
                            ].join('')
                        );
                        
                    }
                    return await step.prompt("choicePrompt", "Would you want this information emailed to you?", ["Yes", "No"]);
                    
                } else {
                    await step.context.sendActivity('Sorry!!, we don\'t find any order');
                    return await step.endDialog();
                }
                // return await step.endDialog();
            },
            async function (step) {
                if (step.result.value.match(/yes/ig)) {

                    await step.context.sendActivity('Email sent!, will keep you posted if there is any change in status at your email');
                
                }
                // await step.context.sendActivity('Thank you');
                return await step.endDialog();
            }
        ]));

    }


    /**
     *
     * Use onTurn to handle an incoming activity, received from a user, process it, and reply as needed
     *
     * @param {TurnContext} on turn context object.
     */
    async onTurn(turnContext) {
        // Handle message activity type. User's responses via text or speech or card interactions flow back to the bot as Message activity.
        // Message activities may contain text, speech, interactive cards, and binary or unknown attachments.
        // see https://aka.ms/about-bot-activity-message to learn more about the message and other activity types
        let dc = await this.dialogSet.createContext(turnContext);
        if (turnContext.activity.type === ActivityTypes.Message) {
            
            const utterance = (turnContext.activity.text || '').trim().toLowerCase();
            if (utterance === 'cancel') {
                if (dc.activeDialog) {
                    await dc.cancelAllDialogs();
                    await dc.context.sendActivity(`Ok... canceled.`);
                } else {
                    await dc.context.sendActivity(`Nothing to cancel.`);
                }
            }

            // Continue the current dialog if one is pending.
            if (!turnContext.responded) {
                await dc.continueDialog();
            }

            // await dc.continueDialog();

            if (!turnContext.responded) {
                await dc.beginDialog('mainMenu');
            }
        } else if (
            turnContext.activity.type === ActivityTypes.ConversationUpdate
        ) {
                        // Do we have any new members added to the conversation?
            if (turnContext.activity.membersAdded.length !== 0) {
                // Iterate over all new members added to the conversation
                for (var idx in turnContext.activity.membersAdded) {
                    // Greet anyone that was not the target (recipient) of this message.
                    // Since the bot is the recipient for events from the channel,
                    // context.activity.membersAdded === context.activity.recipient.Id indicates the
                    // bot was added to the conversation, and the opposite indicates this is a user.
                    if (turnContext.activity.membersAdded[idx].id !== turnContext.activity.recipient.id) {
                        // Send a "this is what the bot does" message.
                        const description = [
                            'Hello Welcome to courier Booking and Tracking bot.',
                            // '\nTo book a courier type:\n`Hi, wanted a book a load OR`\n`Hi, wanted to place an order`\n',
                            // '\nTo check a Status type:\n`Hi, wanted to check the status of an order`'
                        ];
                        await turnContext.sendActivity(description.join(' '));
                        // Start the dialog.
                        // await dc.beginDialog('mainMenu');
                        if (!turnContext.responded) {
                            await dc.continueDialog();
                        }
            
                        // await dc.continueDialog();
            
                        if (!turnContext.responded) {
                            await dc.beginDialog('mainMenu');
                        }
                    }
                }
            }
        }
        // Save state changes
        await this.conversationState.saveChanges(turnContext);
    }
}

exports.EchoBot = EchoBot;
