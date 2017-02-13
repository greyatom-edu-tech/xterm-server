var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var os = require('os');
var pty = require('node-pty');
var cors = require('cors');
app.use(cors());
app.options('*', cors());

var response =
  {
  "id": 41876,
  "first_name": "PradeepJaiswar",
  "last_name": null,
  "full_name": "PradeepJaiswar",
  "username": "PradeepJaiswar",
  "email": "mado023@gmail.com",
  "github_gravatar": "https://avatars.githubusercontent.com/u/4545996",
  "github_uid": 4545996,
  "learn_verified_user": false,
  "can_start_working": true,
};

app.get('/api/v1/users/me', function (req, res) {
  res.send(response);
  res.end();
});

app.get('/signin', function (req, res) {
  res.sendFile(__dirname + '/sign_in.html');
});

app.get('/signin_success', function (req, res) {
  res.sendFile(__dirname + '/signin_success.html');
});

var terminals = '',
    logs = '';

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

app.ws('/notify', function(ws, req) { 
 ws.on('message', function(msg) {
    console.log(msg);
    ws.send(msg);
  });
});

app.ws('/terminals/:pid', function (ws, req) {
  if(terminals[req.params.pid]){
    var term = terminals[req.params.pid];
  }else {
    // var term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
    //       name: 'xterm-color',
    //       cwd: process.env.PWD,
    //       env: process.env
    //     });

    var term = pty.spawn('ssh', ["-i", "/home/ec2-user/xterm.js/demo/githubdemo.pem", "ec2-user@35.154.96.42"], {
          name: 'xterm-color',
          cwd: process.env.PWD,
          env: process.env
        });

    terminals[req.params.pid] = term;
    logs[req.params.pid] = '';
    term.on('data', function(data) {
      logs[req.params.pid] += data;
    });
  }

  ws.send(logs[req.params.pid]);
  term.on('data', function(data) {
    try {
      ws.send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  });
  ws.on('message', function(msg) {
    term.write(msg);
  });
  ws.on('close', function () {
    process.kill(term.pid);
    delete terminals[req.params.pid];
    delete logs[req.params.pid];
  });
});

var port = process.env.PORT || 3000,
    host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

console.log('App listening to http://' + host + ':' + port);
//app.listen(port, host);
//console.log('App listening to http://35.154.96.42:3000');
app.listen(3000);
