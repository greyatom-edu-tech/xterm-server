var https = require('http');
var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var pty = require('node-pty');
var cors = require('cors');
app.use(cors());
app.options('*', cors());


/*
##########################################################
###################FOR TERMINAL DEMO ONLY ################
##########################################################
*/
  app.use('/build', express.static(__dirname + '/../build'));

  app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
  });

/*
##########################################################
###################FOR TERMINAL DEMO ONLY ################
##########################################################
*/

/*
##########get user info ###############
*/
function getTerm(token) {
    return new Promise((resolve, reject) => {
      try {
        return https.get({
            host: 'api.greyatom.com',
            path: '/v1/users/' + token,
            headers: {'access-token': token}
        }, function(response) {
            // Continuously update stream with data
            var body = '';
            response.on('data', function(d) {
                body += d;
            });
            response.on('end', function() {
                try {
                  return resolve(JSON.parse(body));
                } catch (err) {
                    console.log('Parse failed');
                    console.log(err);
                }
            });
        });
      } catch (err) {
        console.log('Api failed');
        console.log(err);
        reject;
      }
    })
}

/*
##########xterm over WebSocket###############
##########Do not edit code below if you are not sure & know what you are doing ###############
*/
app.ws('/terminals/:pid', function (ws, req) {
  try {
    getTerm(req.params.pid)
      .then(user_info => {
        console.log(user_info);
        var term = pty.spawn('sudo', ['su','-',user_info.data.username], {
          name: 'xterm-color',
          env: process.env
        });

        term.on('data', function(data) {
          try {
            ws.send(data);
          } catch (err) {
            console.log('socket was not available');
          }
        });

        ws.on('message', function(msg) {
          term.write(msg);
        });

        ws.on('close', function () {
          console.log('socket disconnecting');
          try {
             process.kill(term.pid);
           } catch (err) {
             console.log('attemp to killing xterm process failed with pid '+ term.pid);
           }
        });
      })
      .catch(err => {
        console.log(err);
      })
  } catch (err) {
      console.log('Terminal webSocket failed');
      console.log(err);
  }
});

/*
##########listen server at port 30000################
*/
console.log('App listening to *:3000');
app.listen(3000);
