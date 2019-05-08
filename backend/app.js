'use strict'
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const compression = require('compression')
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware')
const app = express()
const router = express.Router()
const AWS = require('aws-sdk')
const jwt = require('express-jwt')
const dynamodb = new AWS.DynamoDB.DocumentClient({region: 'us-west-2'})
const tableName = 'Twitch_Questions';
const uuidv4 = require('uuid/v4');
const https = require('https');

if (process.env.NODE_ENV === 'test') {
  // NOTE: aws-serverless-express uses this app for its integration tests
  // and only applies compression to the /sam endpoint during testing.
  router.use('/sam', compression())
} else {
  router.use(compression())
}
//secret is beOUqTTTQbhr4eu5ljsbDYp7Cwp0dVH8f/1GeVbW3hg=
// const secret = Buffer.from(process.env.ENV_SECRET || 'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk', 'base64');
const secret = Buffer.from('beOUqTTTQbhr4eu5ljsbDYp7Cwp0dVH8f/1GeVbW3hg=', 'base64');
console.log(`secret ${process.env.TWITCH_SECRET}`);
router.use(cors())
router.use(bodyParser.json())
router.use(bodyParser.urlencoded({ extended: true }))
router.use(awsServerlessExpressMiddleware.eventContext())

// Auth protected routes for twitch extension
app.use(jwt({ secret: secret,
  getToken: function fromHeaderOrQuerystring (req) {
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
        return req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      return req.query.token;
    }
    return null;
  }
}));

router.get('/questions', async (req, res) =>{
  
  let questions = await getQuestionsByUser(req.query.user_id);
  res.json(questions);
})

router.get('/channelquestions', async (req, res) => {
  let questions = await getQuestionsByChannel(req.query.channel_id);
  res.json(questions);
})

router.post('/question', async (req, res) => {
  console.log(req.body);
   let {channelId, clientId} = req.body.auth;
   console.log(channelId);
  let token = app.getToken(req);
  console.log(token);
  let put = await postQuestion(req.body);
  let twitchpubsubPost = await postToTwitchPubSub('newquestion', token, channelId, clientId);
  console.log(twitchpubsubPost)
  res.json(put);

})

router.put('/answer', async (req, res) => {
  let answer = await updateQuestionAnswer(req.body);
  res.json(answer);
})

const postToTwitchPubSub = async(message, token, channelId, clientId) => {
  // use twitch pubsub 

    fetch(`https://api.twitch.tv/extensions/message/${channelId}`, {
      method: 'POST',
      headers: {
          'Authorization': `Bearer ${token}`,
          'Client-Id': clientId,
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
          content_type: 'application/json',
          message: { message: message },
          targets: ['broadcast']
      })
  })
      .then(response => response.json())
      .then(response => {
          console.log(response);
      })
      .catch(err => { console.log(err) });
}

function makeServerToken(channelId, userId) {
  const payload = {
      exp: Math.floor(Date.now() / 1000) + 30,
      channel_id: channelId.toString(),
      user_id: userId.toString(),
      role: 'external',
      pubsub_perms: {
          send: ['broadcast']
      }
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

const postQuestion = async(questionBody) => {
  console.log(questionBody);
  const { user_id, channel_id, question, postedToForum, displayName } = questionBody;
  const id = uuidv4(); 
  var params = {
    TableName: tableName,
    Item: {
      id, user_id, channel_id, question, postedToForum, displayName
    }
  }

  try{
    let data = await dynamodb.put(params).promise();
    console.log(data);
    return data;
  } catch(error) {
      return error;
  }

}

const updateQuestionAnswer = async(question) => {
  var params = {
    TableName:tableName,
    Key:{
        "id": question.id
    },
    UpdateExpression: "set answer=:answer",
    ExpressionAttributeValues:{
        ":answer": question.answer
    },
    ReturnValues:"UPDATED_NEW"
  };

  try{
    let data = await dynamodb.update(params).promise();
    console.log(data);
    return data;
  } catch(error) {
      return error;
  }
}

const getQuestionsByUser = async (userid) => {
 
  var params = {
    ExpressionAttributeValues: { ":userId":  userid}, 
    KeyConditionExpression: "user_id = :userId", 
    IndexName: "user_id-index",
    TableName: tableName
   };
   
   try{
    let data = await dynamodb.query(params).promise();
    console.log(data);
    return data.Items;
    
   }
   catch(err) {
     console.log(err);
   }


}
const getQuestionsByChannel = async(channelid) => {
  var params = {
    ExpressionAttributeValues: { ":channelId":  channelid}, 
    KeyConditionExpression: "channel_id = :channelId", 
    IndexName: "channel_id-index",
    TableName: tableName
   };
   
   try{
    let data = await dynamodb.query(params).promise();
    console.log(data);
    return data.Items;
    
   }
   catch(err) {
     console.log(err);
   }
}


// The aws-serverless-express library creates a server and listens on a Unix
// Domain Socket for you, so you can remove the usual call to app.listen.
// app.listen(3000)
app.use('/', router)
//https.createServer(router);

// Export your express server so you can import it in the lambda function.
module.exports = app
