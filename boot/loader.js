var elem = {};

(function() {
  /**
   * Root directory of all elements 
   */
  var root = new Dir('/');

  elem.root = root;
  elem.enhance = enhance;
  elem.scan = scan;
  elem.require = require;
  elem.allTags = {};
  elem.findAssociatedDir = findAssociatedDir;

  /**
   * Various ways of exporting
   */
  // Module
  if (typeof module !== 'undefined') {
    module.exports = elem;
  }
  // Webworker
  if (typeof self !== 'undefined') {
    self.elem = elem;
  }
  // Window
  if (typeof window !== 'undefined') {
    window.elem = elem;
  }
  
  /**
   * Environment - "production" or "development"
   */
  var mode = 'development';

  function basedir(filename) {
    return filename.split('/').slice(0,-1).join('/') + '/'
  }

  function ppcss(css, filename) {
    if (typeof document === 'undefined') {
      return css;
    }

    if(mode == 'development') {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = filename + '?' + elem.buildId;
      document.head.appendChild(link);
    }
    else {
      var dir = basedir(filename);
      css = css.replace(/(@import\s*['?"?])([^\/|.*?\/\/])/g, '$1'+dir+'$2')
      css = css.replace(/(url\(['?"?])([^\/|.*?\/\/|#|data:])/g, '$1'+dir+'$2')

      var style = document.createElement('style');
      style.innerHTML = css;
      document.head.appendChild(style);
    }

    return css;
  }

  function pphtml(html) {

    var dir = html.parent;

    html.data = '<!-- '+html.path+' -->\n' + html.data;

    if(!(dir instanceof Dir)) return html.data;

    return html.data.replace(/\.\//m, dir.path)

    return html.data;
  }

  /**
   * TODO: This needs to be able to handle conflicting
   *       names in different directories.
   */
  function findAssociatedDir(node) {
    return elem.allTags[node.tagName];
  }

  /**
   * Apply self-named resources to an element.
   * 
   * e.g. Within directory page/, applies page.js if present 
   *
   * If Javascript is found it is used to fill out an "exports" object on the directory. 
   * If HTML is found it is used as the innerHTML ONLY if there is there are no existing children.
   * If CSS is found it is linked to the document head. 
   *
   * @param {DOMElement} The target element to enhance 
   * @param {Dir} dir Custom element directory
   * @param {Function} done Callback 
   */
  function enhance(elem, dir) {
    if (!elem) {
      return false;
    }

    // Always enhance once
    if (elem.__elem_enhanced) {
      return true;
    }

    dir = dir || findAssociatedDir(elem);
    if (!dir) return false;

    // If removed from the dom after we
    // scheduled it for enhancement, cancel
    if (!elem.ownerDocument.contains(elem)) {
      return;
    }

    elem.__elem_enhanced = dir;

    function rescan(node) {
      // Re-scan this element against
      // ancestor directories
      // The impl could have introduced
      // new matchable elements.
      var node = elem;
      while(node) {
        var pdir = node.__elem_enhanced;
        if(pdir) {
          scan(elem, pdir);
        }
        node = node.parentElement;
      }

      // And root
      scan(elem, root);
    }

    function render(html) {
      if(html) {
        if(html instanceof Element) {
          elem.innerHTML = '';
          elem.appendChild( html );
        }
        else if(typeof html === 'string') {
          html = '<!-- generated by '+dir.path+' -->\n' + html;
          elem.innerHTML = html;
        }
        else if(typeof html === 'object'
                && html.length) {
          elem.innerHTML = '';
          for(var i=0,l=html.length; i<l; ++i) {
            elem.appendChild( html[i] );
          }
        }
      }

      rescan();
    }

    var html = require(dir.path,'html');
    if(html) {
      elem.innerHTML = html;
    }

    var impl = require(dir.path,'js');
    if(impl) {

      if(typeof impl === 'function') {
        if(impl.length == 0) {
          var html = impl.call(elem); 
          render(html);
        }
        else if(impl.length == 2) {
          impl.call(elem, {deprecated: 'deprecated'}, render); 
        }
        else {
          impl.call(elem, render); 
        }
      }
      else {
        render();
      }
    }
    else {
      render();
    }
  }

  /**
   * Searches a base element for instances of custom elements,
   * loads the resources, and then calls enhance().
   * 
   * @param {DOMElement} base The root element to search within
   * @param {Dir} dir Custom element directory
   */

  function scan(base, dir) {
    dir = dir || root; // Default to root

    var uses = dir.findAll(base);

    uses = uses.sort(function(a,b) {
      if( a === b) return 0;
      if( !a.compareDocumentPosition) {
        // support for IE8 and below
        return a.sourceIndex - b.sourceIndex;
      }
      if( a.compareDocumentPosition(b) & 2) {
        // b comes before a
        return 1;
      }
      return -1;
    });

    each(uses, function(elem) {
      var tagName = elem.tagName.toLowerCase();
      var path = [];

      var tmp = dir;
      while(tmp) {
        if(tmp[tagName]) {
          path.unshift(tmp[tagName]);
        }
        tmp = tmp.parent;
      }

      // Must load all first an enhance in order
      parallel(path, function() {
        each(path, function(dir) {
          enhance(elem, dir);
        });
      });
    });
  }

  /**
   * A simple XMLHttpRequest GET.
   *
   * @param {String} url URL to fetch 
   * @param {Function} done Callback 
   */
  function ajax(url,done) {
    var xmlhttp;

    if (elem.buildId) {
      url += '?'+elem.buildId;
    }

    if(typeof XMLHttpRequest !== 'undefined') {
      xmlhttp = new XMLHttpRequest(); // Browsers
    }
    else {
      xmlhttp = new ActiveXObject("Microsoft.XMLHTTP"); // IE
    }

    xmlhttp.onreadystatechange = function() {
      if(xmlhttp.readyState == 4
      && xmlhttp.status == 200) {
        done(null, xmlhttp.responseText)
      }
    }

    xmlhttp.open("GET", url, true);
    xmlhttp.send();
  }

  /**
   * Gets a file relative to the root path
   * If `development`, or `production` environment
   * this uses XMLHTTPRequest, but in `test` mode
   * it will use native node `fs.readFileSync`.
   *
   * @param {String} path
   * @param {Function} done function(err, data)
   */
  function get(path,done) {
    if (mode === 'test') {
      var fs = nodeRequire('fs');
      var data = ''+fs.readFileSync(root.path+path);
      done(null, data);
    }
    else {
      ajax(elem.domain+root.path+path, done);
    }
  }

  function select(base, tags) {
    var elems = [];
    each(tags, function(tag) {
      var all = base.getElementsByTagName(tag);
      for(var i=0,l=all.length; i < l; ++i) {
        elems.push(all[i]);
      }
    });
    return elems;
  }


  /**
   * Simple parallel processor.
   */
  function parallel(objs, done) {
    var count = objs.length;

    if(objs.length === 0) done();

    each(objs, function(obj) {
      obj.load(function() {
        if(--count == 0) {
          done();
        }
      });
    });
  }

  /**
   * Dir
   *
   * A local mapping of a server-side directory.
   *
   * @param {Dir} parent Parent directory object
   * @param {String} path path of the directory
   */
  function Dir(path, parent) {
    this.parent = parent;
    this.path = path;
    this.availTags = [];
    this.observers = [];
  }

  Dir.prototype.findAll = function(base) {
    var tags = this.availTags;

    if(this.parent) {
      tags = tags.concat(this.parent.availTags);
    }

    return select(base, tags);
  };

  Dir.prototype.observe = function(done) {
    this.observers.push(done);
  }

  Dir.prototype.complete = function() {
    if(this.loaded) return;

    this.loaded = true;
    this.loading = false;
    this.observers.forEach(function(fn) {
      fn();
    });
    this.observers = [];
  }

  Dir.prototype.children = function(recursive) {
    var files = [];

    for(var filename in this) {
      if(filename == 'parent') continue;

      var f = this[filename];

      if(f instanceof File) {
        files.push(this[filename]);
      }

      if(f instanceof Dir) {
        if(recursive || filename == this.tagName) {
          [].push.apply(files, f.children(recursive));
        }
      }
    }

    return files;
  }

  Dir.prototype.isLoaded = function(recursive) {
    if(this.loaded) {
      return true;
    }

    if(this.loading) {

      this.loaded = this.children().reduce(function(a,b) {
        return a && b.isLoaded()
      }, true);
    }

    return this.loaded;
  }

  Dir.prototype.load = function(done, recursive) {
   var self = this;

    if(this.isLoaded()) {
      done();
      return;
    }

    this.observe(done);

    if(this.loading) {
      return;
    }

    this.loading = true;


    var resources = [];

    // FIXME
    // We should not need to sort client-side
    // Just do things in order of the index...
    // This whole thing is a huge waste of bytes
    if(this.window && typeof window !== 'undefined') {
      [].push.apply(resources, this.window.children(true));

      var self = this;
      this.window.load(function() {
        function runAll(dir) { 
          var globals = Object.keys(dir);

          globals = globals.sort(function(a,b) {
            return b.length < a.length ? 1 : -1;
          });

          each(globals, function(name) {
            if(dir[name] instanceof File) {
              var path = dir[name].path;
              require(path,'js');
            }
          });

          each(globals, function(name) {
            if(name == 'parent') return;
            if(dir[name] instanceof Dir) {
              runAll(dir[name]);
            }
          });
        }

        runAll(self.window);
      }, true);

    }

    // If not in test mode, recursively load
    // all children automatically.
    //
    // Since test mode can synchronously read
    // files as they are required we can speed
    // up tests by only loading them when they
    // are required, later.
    //
    // The browser on the other hand, must have
    // everything available beforehand.
    if (mode !== 'test') {
      [].push.apply(resources, this.children(true));
    }

    parallel(resources, function() {
      self.complete()
    });

  };

  function jsfn(txt, isGlobal) {
    var fn;

    if(isGlobal) {
      fn = new Function(txt);
    }
    else {
      fn = new Function('module','exports','require', txt);
    }

    return fn;
  }

  function normalize(path) {
    var result = [];
    var parts;
    var token;

    parts = path.split('/');

    for(var i=0, l=parts.length; i < l; ++i) {
      token = parts[i];

      if (token === '..') {
        result.pop();
      } else if (token && token !== '.') {
        result.push(token);
      }
    }
    return result.join('/').replace(/[\/]{2,}/g, '/'); 
  }

  function resolve(base,rel) {
    var basedir = base.split('/').slice(0,-1).join('/');
    var pathname = [basedir,rel].join('/');
    return normalize(pathname); 
  }



  /**
   * Finds dependencies given a base just like node requires
   * but with an abstract extension.
   *
   * Examples:
   *
   * require('../body','js','/elements/header/header.js')
   * require('../body','html','/elements/header/header.js')
   *
   * @param {String} filename Module path
   * @param {String} ext File extension to look for  
   * @param {String} basename Reference point for relative paths  
   */

  function require(filename, ext, basename) {
    ext = ext || 'js';
    basename = basename || "/";

    var relpath = resolve(basename, filename); 

    var lastname = relpath.split('/').filter(function(n){return n;}).slice(-1)[0] || '';

    var file;

    filename = filename.toLowerCase();
    lastname = lastname.toLowerCase();
    relpath = relpath.toLowerCase();

    // Make a list of possible paths
    var possible = [
      relpath,
      relpath+'.'+ext,
      relpath+'/'+lastname+'.'+ext,
      relpath+'/index.'+ext,
      globalModules[filename]
    ];

    // Try all of them in order
    while(possible.length) {
      var attempt = File.map[possible.pop()];
      if(attempt) {
        file = attempt;
        break;
      }
    }

    if(!file) {
      return false;
    }

    // For test mode, since we don't load children
    // recursively, we need to do it here on require.
    // And test mode loading is synchronous so this
    // will complete immediately.
    if (mode === 'test') {
      file.load(function noop(){});
    }

    if(file.tagName != 'js') {
      return file.data;
    }

    var js = file.data + '\r\n//# sourceURL=' + root.path + file.path;

    var isGlobal = file.isGlobal();
    var fn = jsfn(js, isGlobal);

    if(isGlobal) {
      fn();
      return false;
    }

    // If we already executed return exports
    if(file.module) return file.module.exports;

    // Run for the first time and save exports
    function localRequire(name, ext) {
      ext = ext || 'js';
      var dep = require(name, ext, file.path);
      if(!dep) {
        throw new Error("failed to require "+name+" from "+file.path);
      }
      return dep;
    }

    var module = {exports: {}};
    file.module = module;
    fn.call(module.exports, module, module.exports, localRequire); 

    return module.exports;
  }

  /**
   * File
   *
   * Local tracker object for a single remote file.
   *
   * @param {String} path The path of the file relative to global `base`
   * @param {Dir} parent Parent dir object of the file
   */

  function File(path, parent) {
    this.observers = [];
    this.loading = false;
    this.loaded = false;
    this.path = path;
    this.parent = parent;

    File.map[path.toLowerCase()] = this; 
  }

  File.map = {};

  File.prototype = {
    handle: function() {
      var file = this.path;
      var ext = file.split('.').slice(-1)[0];

      var handlers = {
        html: pphtml,
        css: ppcss,
        json: ppjson,
        js: ppjs
      };

      if(handlers[ext]) {
        handlers[ext](name, data, file);
      }
    }


  , isLoaded: function() {
      return this.loaded;
    }


  , isGlobal: function() {
      var dir = this;

      while(dir) {
        if(dir.tagName === 'window')
          return true;
        dir = dir.parent;
      }
      return false;
    }

  , complete: function() {
      this.loading = false;
      this.loaded = true;

      var ext = this.path.split('.').slice(-1)[0];

      if(ext == 'js') {
        this.data = '\n// ' + this.path + '\n\n' + this.data;
      }

      if(ext == 'json') {
        this.data = JSON.parse(this.data);
      }

      if(ext == 'css') {
        ppcss(this.data, root.path+this.path);
      }

      if(ext == 'html') {
        this.data = pphtml(this);
      }

      each(this.observers, function(done) {
        done();
      });

      this.observers = [];
    }

  , observe: function(done) {
      this.observers.push(done);
    }

  , load: function(done) {
     var self = this;

      if(this.loaded) {
        done();
        return;
      }

      // No need to ajax load
      // css since we link it
      if(mode == 'development'
        && this.path.match(/\.css$/)) {
        this.data = '';
        self.complete();
        done();
        return;
      }

      this.observe(done);

      if(this.loading) {
        return;
      }

      this.loading = true;

      var pkgpath = packages[this.path];

      // css since we link it
      if(pkgpath) {
        var pkg = File.map[pkgpath];

        pkg.load(function() {
          self.data = pkg.data[self.path];
          self.complete();
        });
      }
      else {
        get(self.path, function(err, data) {
          self.data = data;
          self.complete();

          if(err) {
            console.error('Problem loading ' + self.path);
            return;
          }
        });
      }
    }
  };

  var globalModules = {};
  var packages = {};

  function parseIndex(json) {
    var files = json.files;
    var modules = json.modules;
    globalModules = json.modules;
    packages = json.packages;

    var base = '/';
    each(files, function(file) {

      var nodes = file.split(/[\/|\.]/);
      var numDirs = file.split('/').length+1;

      var parent = root;
      var parentName = null;
      var dirpath = base;

      each(nodes, function(node,i) {

        // Space not allowed
        // TODO make actual accepted symbols
        if(node.match(/\s/)) return;

        // Merge _ prefixed directories in
        // to the parent directory
        if(node && node[0] != '_') {

          if(--numDirs) {
            dirpath += node + '/';
          }

          if(i == nodes.length-1) {
            var resource = new File(file, parent);
            parent[node] = resource;
            parent[node].tagName = node;
          }
          else {
            var dir = parent[node] = parent[node] || new Dir(dirpath, parent);

            dir.tagName = node;
            elem.allTags[node.toUpperCase()] = dir;
            // elem.allTags[node] = elem.allTags[node] || [];
            // elem.allTags[node].push(dir);

            // Old IEs needs this.
            // It's a classic way of getting HTML5
            // elements recognized.
            // document.createElement(node);

            if(parent.availTags.indexOf(node) == -1) { 
              parent.availTags.push(node);
            }
          }

          parent = parent[node];
          parentName = node; 
        }
      });


    });
  }

  var started = false;
  elem.start = function(config) {
    if(started) {
      throw 'elem.start() called twice!';
    }
    started = true;

    elem.domain = config.domain;
    elem.buildId = config.buildId;
    root.path = config.basePath || '/';
    mode = config.mode || 'development';

    parseIndex(config.index);

    root.load(function() {
      // No document actually required
      // (we can run in webworkers)
      if (typeof document !== 'undefined') {
        domReady(function() {
          setupDOMHooks();
          scan(document, root);
        });
      }
    });
  }

  // We don't support IE6 or 7. We can do a much simpler document ready check.
  function domReady(callback) {
    if (document.readyState !== "loading") return callback();

    var addListener = document.addEventListener || document.attachEvent,
    removeListener =  document.removeEventListener || document.detachEvent
    eventName = document.addEventListener ? "DOMContentLoaded" : "onreadystatechange"

    addListener.call(document, eventName, function(){
      removeListener.call(document, eventName, arguments.callee, false )
      callback()
    }, false )
  }

  function setupDOMHooks() {
    var _appendChild = HTMLElement.prototype.appendChild;
    HTMLElement.prototype.appendChild = function(child) {
      var result = _appendChild.apply(this, arguments);
      elem.enhance(child);
      return result;
    }

    var _insertBefore = HTMLElement.prototype.appendChild;
    HTMLElement.prototype.insertBefore = function(noop, child) {
      var result = _insertBefore.apply(this, arguments);
      elem.enhance(child);
      return result;
    }

    var _replaceChild = HTMLElement.prototype.replaceChild;
    HTMLElement.prototype.replaceChild = function(noop, child) {
      var result = _replaceChild.apply(this, arguments);
      elem.enhance(child);
      return result;
    }
  }

  function each(arr,fn) {
    for(var i=0,l=arr.length;i<l;++i) {
      fn(arr[i],i);
    }
  }
})();
