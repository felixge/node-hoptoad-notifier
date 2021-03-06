var HTTP        = require('http');
var querystring = require('querystring');
var Hoptoad = {
  VERSION           : '0.1.0',
  NOTICE_XML        : '<?xml version="1.0" encoding="UTF-8"?><notice version="2.0"><api-key>API_KEY</api-key><notifier><name>node-hoptoad-notifier</name><version>0.1.0</version><url>http://github.com/tristandunn/node-hoptoad-notifier</url></notifier><error><class>EXCEPTION_CLASS</class><message>EXCEPTION_MESSAGE</message><backtrace>BACKTRACE_LINES</backtrace></error><request><url>REQUEST_URL</url><component>REQUEST_COMPONENT</component><action>REQUEST_ACTION</action></request><server-environment><project-root>PROJECT_ROOT</project-root><environment-name></environment-name></server-environment></notice>',
  BACKTRACE_MATCHER : /\s*at\s?(.*)? \(?([^\:]+)\:(\d+)\:(\d+)\)?/,
  root              : process.cwd(),
  backtrace_filters : [/hoptoad-notifier\.js/],

  notify: function(error, cb) {
    this._configure();

    var xml     = Hoptoad.generateXML(error);
    var client  = HTTP.createClient(80, 'hoptoadapp.com');
    var headers = { 'Host'           : 'hoptoadapp.com',
                    'Content-Type'   : 'text/xml',
                    'Content-Length' : xml.length };
    var request = client.request('POST', '/notifier_api/v2/notices', headers);


    var called = false;
    function callback(err) {
      if (called || !cb) {
        return;
      }

      called = true;
      cb(err);
    }

    request
      .on('error', callback)
      .on('response', function(response) {
        response
          .on('error', callback)
          .on('end', function() {
            if (response.statusCode < 200 || response.statusCode >= 400) {
              callback(new Error('hoptoad: bad status code: '+response.statusCode));
              return;
            }

            callback();
          });
      });

    request.write(xml);
    request.end();
  },

  deploy: function(params, cb) {
    cb = cb || function() {};

    var params = {
      'api_key': Hoptoad.API_KEY,
      'deploy[rails_env]': Hoptoad.ENVIRONMENT,
      'deploy[local_username]': params.user || process.env.USER,
      'deploy[scm_revision]': params.revision || '',
      'deploy[scm_repository]': params.repository || '',
    };
    params = querystring.stringify(params);

    var request = HTTP.request({
      method: 'POST',
      host: 'hoptoadapp.com',
      port: 80,
      path: '/deploys.txt',
      headers: {
        'content-length': params.length,
        'content-type': 'application/x-www-form-urlencoded'
      },
    });

    request.write(params);
    request.end();

    request
      .on('error', cb)
      .on('response', function(res) {
        var data = '';
        res
          .on('data', function(chunk) {
            data += chunk;
          })
          .on('end', function() {
            if (res.statusCode !== 200) {
              var err = new Error('Response code: ' + res.statusCode + ': ' + data);
              cb(err);
              return;
            }

            cb(null, data);
          });
      });
  },

  _configure: function() {
    if (Hoptoad.API_KEY === undefined && process.env['HOPTOAD_API_KEY']) {
      Hoptoad.key = process.env['HOPTOAD_API_KEY'];
    }

    if (Hoptoad.ENVIRONMENT === undefined) {
      Hoptoad.environment = process.env['RACK_ENV'] ||
                            process.env['NODE_ENV'] ||
                            'production';
    }
  },

  set environment(value) {
    var matcher = /<environment-name>.*<\/environment-name>/;

    Hoptoad.ENVIRONMENT = value;
    Hoptoad.NOTICE_XML  = Hoptoad.NOTICE_XML.replace(matcher,
                                                     '<environment-name>' +
                                                       value +
                                                     '</environment-name>');
  },

  set key(value) {
    var matcher = /<api-key>.*<\/api-key>/;

    Hoptoad.API_KEY    = value;
    Hoptoad.NOTICE_XML = Hoptoad.NOTICE_XML.replace(matcher,
                                                    '<api-key>' +
                                                      value +
                                                    '</api-key>');
  },

  generateBacktrace: function(error) {
    error = error || {};

    if (typeof error.stack != 'string') {
      try {
        (0)();
      } catch(e) {
        error.stack = e.stack;
      }
    }

    return error.stack.split("\n").filter(function(line) {
      return Hoptoad.backtrace_filters.every(function(filter) {
        return !line.match(filter);
      });
    }).map(function(line) {
      var matches = line.match(Hoptoad.BACKTRACE_MATCHER);

      if (matches) {
        var file = matches[2].replace(Hoptoad.root, '[PROJECT_ROOT]');

        return '<line method="' + Hoptoad.escapeText(matches[1] || '') +
                     '" file="' + Hoptoad.escapeText(file) +
                   '" number="' + matches[3] + '" />';
      }
    }).filter(function(line) {
      return line !== undefined;
    });
  },

  generateXML: function(error) {
    var xml  = Hoptoad.NOTICE_XML;
    var root = Hoptoad.escapeText(Hoptoad.root);

    var url       = Hoptoad.escapeText(error.url       || '');
    var type      = Hoptoad.escapeText(error.type      || 'Error');
    var action    = Hoptoad.escapeText(error.action    || '');
    var message   = Hoptoad.escapeText(error.message   || 'Unknown error.');
    var component = Hoptoad.escapeText(error.component || '');
    var backtrace = Hoptoad.generateBacktrace(error);

    if (url.trim() == '' && component.trim() == '') {
      xml = xml.replace(/<request>.*<\/request>/, '');
    } else {
      var data = '';

      ['params', 'session', 'cgi-data'].forEach(function(type) {
        if (error[type]) {
          data += '<' + type + '>';
          data += Hoptoad.generateVariables(error[type]);
          data += '</' + type + '>';
        }
      });

      xml = xml.replace('</request>',        data + '</request>')
               .replace('REQUEST_URL',       url)
               .replace('REQUEST_ACTION',    action)
               .replace('REQUEST_COMPONENT', component);
    }

    return xml.replace('PROJECT_ROOT',      root)
              .replace('EXCEPTION_CLASS',   type)
              .replace('EXCEPTION_MESSAGE', message)
              .replace('BACKTRACE_LINES',   backtrace.join(''));
  },

  generateVariables: function(parameters) {
    var key;
    var result = '';

    for (key in parameters) {
      result += '<var key="' + Hoptoad.escapeText(key) + '">' +
                  Hoptoad.escapeText(parameters[key]) +
                '</var>';
    }

    return result;
  },

  escapeText: function(text) {
    return text.replace(/&/g, '&#38;')
               .replace(/</g, '&#60;')
               .replace(/>/g, '&#62;')
               .replace(/'/g, '&#39;')
               .replace(/"/g, '&#34;');
  }
};

exports.Hoptoad = Hoptoad;
