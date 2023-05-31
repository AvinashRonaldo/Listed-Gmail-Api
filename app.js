const express = require('express');
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const file = require('fs');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

const repliedEmailsFile = path.join(process.cwd(),'repliedEmails.json');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly',
"https://www.googleapis.com/auth/gmail.modify"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
let repliedEmails = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve,ms));


/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }

  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listLabels(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  const res = await gmail.users.labels.list({
    userId: 'me',
  });
  const labels = res.data.labels;
  if (!labels || labels.length === 0) {
    console.log('No labels found.');
    return;
  }
  console.log('Labels:');
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}

//Getting a list of messages in users account
async function listmessages(auth){
    const gmail = google.gmail({version:"v1",auth});
    const res = await gmail.users.messages.list({
        userId:"me",
    });
    console.log(res.data);
    return res.data.messages;
}

function saveRepliedEmails(){
    file.writeFileSync(repliedEmailsFile, JSON.stringify([...repliedEmails]));
}

function loadRepliedEmails(){
    try {
        const data = file.readFileSync(repliedEmailsFile);
        repliedEmails = new Set(JSON.parse(data));
      } catch (err) {
        // File doesn't exist or error occurred while reading
        repliedEmails = new Set();
    }
}

//Get vacation status of user
async function vacationStatus(auth){
    try
    {    
        const gmail = google.gmail({version:"v1",auth});
        const res = await gmail.users.settings.getVacation({
        userId:"me",
        });
        const {enableAutoReply} = res.data;
        if(enableAutoReply){
            console.log("User is in Vacation");
        }
        else{
            console.log("User is not on Vacation");
        }
        await watchInbox(auth);
    } catch(err){
        console.log(err);
    }
}

//Wath Inbox of user for new Incoming messages
async function watchInbox(auth){
    try {
        const gmail = google.gmail({version:"v1",auth});
        let res = await gmail.users.watch({
            userId:"me",
            requestBody:{
                topicName:"projects/gmail-app-388306/topics/gmail"
            }
        });
        if(res){
                let result =await gmail.users.messages.list({
                    userId:"me",
                    q:'is:inbox is:unread'
                }); 
                const newMessages = result.data.messages || [];
                for(const msg of newMessages){
                    const msgData = await gmail.users.messages.get({
                        userId:"me",
                        id:msg.id
                    });
                    const threadId = msgData.data.threadId;
                    const threadData = await gmail.users.threads.get({
                          userId: "me",
                          id: threadId,
                    });
                    if (
                        threadData.data.messages.length === 1 &&
                        threadData.data.messages[0].labelIds.includes('INBOX') &&
                        !repliedEmails.has(threadId)
                      ) {
                        // First-time email, send a reply
                        await sendAutoReply(gmail, threadData.data.messages[0].id);
                        repliedEmails.add(threadId);
                        
                      }
                    const interval = Math.floor(Math.random() * (120 - 45 + 1) + 45);
                    await sleep(interval * 10);
                }  
            };
        }
    catch(err){
        console.log(err);
    }
}

async function sendAutoReply(gmail,mId){
    try{
        const response = await gmail.users.messages.get({
            userId:"me",
            id:mId,
            format:'full'
        });
        const val = response.data.payload.headers;
        const fromHeader = val.find((header) => header.name.toLowerCase() === 'from');

        const from = fromHeader ? fromHeader.value : '';
        const replyMessage = `Thank you for your email.I am currently on vacation and will reply to your message as soon as I return.`;

        const headers = {
            To: from,
            Subject: `Re: Vacay Mode`,
        };
        const email = [
            `Content-Type: text/plain; charset="UTF-8"\n`,
            'MIME-Version: 1.0\n',
            `Content-Transfer-Encoding: 7bit\n`,
            `to: ${headers.To}\n`,
            `subject: ${headers.Subject}\n\n`,
            `${replyMessage}`,
          ].join('');
        const encodedEmail = Buffer.from(email).toString('base64');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedEmail,
            },
        });
        console.log(`Auto-reply sent to ${from}`);
    } catch(err){
        console.log(err);
    }
}

//authorize().then(listLabels).catch(console.error);

/*async function getMessagesList(){
    let  auth = await authorize();
    let data = await listmessages(auth);
    return data;
}



app.get("/messages",async(req,res) => {
    let data = await getMessagesList();
    res.send(data);
})

;
*/
async function startApp(){
    try{
        loadRepliedEmails();
        let auth = await authorize();
        await vacationStatus(auth);
    } catch(err){
        console.log(err);
    }
}

const app = express();
app.listen(3000,async() => {
    await startApp();
})

process.on('SIGINT', () => {
    console.log("Exiting");
    saveRepliedEmails();
    process.exit();
});
