var http = require('http');
var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var pty = require('node-pty');
var cors = require('cors');
app.use(cors());
app.options('*', cors());
var terminals = ''; //global terminals

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
      return http.get({
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
              return resolve(JSON.parse(body));
          });
      });
    })
}

/*
##########xterm over WebSocket###############
##########Do not edit code below if you are not sure & know what you are doing ###############
*/
app.ws('/terminals/:pid', function (ws, req) {
  getTerm(req.params.pid)
    .then(user_info => {
      console.log(user_info);
      if(terminals[req.params.pid]){
        var term = terminals[req.params.pid];
      }else {
        // var term = pty.spawn('ssh', ["-i", user_info.pem_file, user_info.user_host], {
        var term = pty.spawn('sudo', ['su','-',user_info.username], {
          name: 'xterm-color',
          cwd: process.env.PWD,
          env: process.env
        });
        terminals[req.params.pid] = term;
      }

      term.on('data', function(data) {
        ws.send(data);
      });

      ws.on('message', function(msg) {
        term.write(msg);
      });

      ws.on('close', function () {
        // process.kill(term.pid);
        // delete terminals[req.params.pid];
        // delete logs[req.params.pid];
      });
    })
    .catch(err => {
      // console.log(err);
    })
});

/*
##########listen server at port 30000################
*/
console.log('App listening to *:3000');
app.listen(3000);
