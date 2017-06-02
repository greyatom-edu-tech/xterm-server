var https = require('https');
var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var pty = require('node-pty');
var cors = require('cors');
app.use(cors());
app.options('*', cors());
var cwds = {}; 
var cmd = require('node-cmd');

/*
##########################################################
###################FOR TERMINAL DEMO ONLY ################
##########################################################
*/
  app.use('/build', express.static(__dirname + '/../build'));

  app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
  });

  app.get('/style.css', function(req, res){
    res.sendFile(__dirname + '/style.css');
  });

  app.get('/main.js', function(req, res){
    res.sendFile(__dirname + '/main.js');
  });
/*
##########################################################
###################FOR TERMINAL DEMO ONLY ################
##########################################################
*/

/*
##########get user info and .pem file path###############
*/
function getTerm(token) {
    return new Promise((resolve, reject) => {
      try {
        return https.get({
            host: 'api.commit.live',
            path: '/v1/users/' + token,
            headers: {'access-token': token}
        }, function(response) {
            // Continuously update stream with data
            var body = '';
            response.on('data', function(d) {
                body += d;
            });
            response.on('end', function() {
                //console.log(body);
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
        var pcwd = process.env.PWD;
        console.log('i am here');
        console.log(pcwd);
        if(cwds[req.params.pid]){
          pcwd = cwds[req.params.pid];
        }
        // var term = pty.spawn('ssh', ["-i", user_info.pem_file, user_info.user_host], {
        var term = pty.spawn('sudo', ['su','-',user_info.data.username], {
          name: 'xterm-color',
          cwd: pcwd,
          env: process.env
        });

        term.on('data', function(data) {
          try {
            ws.send(data);
            var command = "lsof -a -p "+term.pid+" -d cwd -n | tail -1 | awk '{print $NF}'"
            cmd.get(
                command,
                function(err, data, stderr){
                    cwds[req.params.pid] = data.trim();
                }
            );
          } catch (err) {
          }
        });

        ws.on('message', function(msg) {
          term.write(msg);
        });

        ws.on('close', function () {
          console.log('socket disconnecting');
          var command = "lsof -a -p "+term.pid+" -d cwd -n | tail -1 | awk '{print $NF}'"
          cmd.get(
              command,
              function(err, data, stderr){
                  cwds[req.params.pid] = data.trim();
                  process.kill(term.pid);
              }
          );
        });
      })
      .catch(err => {
        // console.log(err);
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
