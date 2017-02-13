"use strict";
var CompositionHelper_1 = require("./CompositionHelper");
var EventEmitter_1 = require("./EventEmitter");
var Viewport_1 = require("./Viewport");
var Clipboard_1 = require("./handlers/Clipboard");
var CircularList_1 = require("./utils/CircularList");
var EscapeSequences_1 = require("./EscapeSequences");
var CharMeasure_1 = require("./utils/CharMeasure");
var Browser = require("./utils/Browser");
var document = (typeof window != 'undefined') ? window.document : null;
var normal = 0, escaped = 1, csi = 2, osc = 3, charset = 4, dcs = 5, ignore = 6;
var WRITE_BUFFER_PAUSE_THRESHOLD = 5;
var WRITE_BATCH_SIZE = 300;
var MAX_REFRESH_FRAME_SKIP = 5;
function Terminal(options) {
    var self = this;
    if (!(this instanceof Terminal)) {
        return new Terminal(arguments[0], arguments[1], arguments[2]);
    }
    self.browser = Browser;
    self.cancel = Terminal.cancel;
    EventEmitter_1.EventEmitter.call(this);
    if (typeof options === 'number') {
        options = {
            cols: arguments[0],
            rows: arguments[1],
            handler: arguments[2]
        };
    }
    options = options || {};
    Object.keys(Terminal.defaults).forEach(function (key) {
        if (options[key] == null) {
            options[key] = Terminal.options[key];
            if (Terminal[key] !== Terminal.defaults[key]) {
                options[key] = Terminal[key];
            }
        }
        self[key] = options[key];
    });
    if (options.colors.length === 8) {
        options.colors = options.colors.concat(Terminal._colors.slice(8));
    }
    else if (options.colors.length === 16) {
        options.colors = options.colors.concat(Terminal._colors.slice(16));
    }
    else if (options.colors.length === 10) {
        options.colors = options.colors.slice(0, -2).concat(Terminal._colors.slice(8, -2), options.colors.slice(-2));
    }
    else if (options.colors.length === 18) {
        options.colors = options.colors.concat(Terminal._colors.slice(16, -2), options.colors.slice(-2));
    }
    this.colors = options.colors;
    this.options = options;
    this.parent = options.body || options.parent || (document ? document.getElementsByTagName('body')[0] : null);
    this.cols = options.cols || options.geometry[0];
    this.rows = options.rows || options.geometry[1];
    this.geometry = [this.cols, this.rows];
    if (options.handler) {
        this.on('data', options.handler);
    }
    this.ybase = 0;
    this.ydisp = 0;
    this.x = 0;
    this.y = 0;
    this.refreshRowsQueue = [];
    this.cursorState = 0;
    this.cursorHidden = false;
    this.convertEol;
    this.state = 0;
    this.queue = '';
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.customKeydownHandler = null;
    this.applicationKeypad = false;
    this.applicationCursor = false;
    this.originMode = false;
    this.insertMode = false;
    this.wraparoundMode = true;
    this.normal = null;
    this.charset = null;
    this.gcharset = null;
    this.glevel = 0;
    this.charsets = [null];
    this.decLocator;
    this.x10Mouse;
    this.vt200Mouse;
    this.vt300Mouse;
    this.normalMouse;
    this.mouseEvents;
    this.sendFocus;
    this.utfMouse;
    this.sgrMouse;
    this.urxvtMouse;
    this.element;
    this.children;
    this.refreshStart;
    this.refreshEnd;
    this.savedX;
    this.savedY;
    this.savedCols;
    this.readable = true;
    this.writable = true;
    this.defAttr = (0 << 18) | (257 << 9) | (256 << 0);
    this.curAttr = this.defAttr;
    this.params = [];
    this.currentParam = 0;
    this.prefix = '';
    this.postfix = '';
    this.writeBuffer = [];
    this.writeInProgress = false;
    this.refreshFramesSkipped = 0;
    this.xoffSentToCatchUp = false;
    this.writeStopped = false;
    this.surrogate_high = '';
    this.lines = new CircularList_1.CircularList(this.scrollback);
    var i = this.rows;
    while (i--) {
        this.lines.push(this.blankLine());
    }
    this.tabs;
    this.setupStops();
    this.userScrolling = false;
}
inherits(Terminal, EventEmitter_1.EventEmitter);
Terminal.prototype.eraseAttr = function () {
    return (this.defAttr & ~0x1ff) | (this.curAttr & 0x1ff);
};
Terminal.tangoColors = [
    '#2e3436',
    '#cc0000',
    '#4e9a06',
    '#c4a000',
    '#3465a4',
    '#75507b',
    '#06989a',
    '#d3d7cf',
    '#555753',
    '#ef2929',
    '#8ae234',
    '#fce94f',
    '#729fcf',
    '#ad7fa8',
    '#34e2e2',
    '#eeeeec'
];
Terminal.colors = (function () {
    var colors = Terminal.tangoColors.slice(), r = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff], i;
    i = 0;
    for (; i < 216; i++) {
        out(r[(i / 36) % 6 | 0], r[(i / 6) % 6 | 0], r[i % 6]);
    }
    i = 0;
    for (; i < 24; i++) {
        r = 8 + i * 10;
        out(r, r, r);
    }
    function out(r, g, b) {
        colors.push('#' + hex(r) + hex(g) + hex(b));
    }
    function hex(c) {
        c = c.toString(16);
        return c.length < 2 ? '0' + c : c;
    }
    return colors;
})();
Terminal._colors = Terminal.colors.slice();
Terminal.vcolors = (function () {
    var out = [], colors = Terminal.colors, i = 0, color;
    for (; i < 256; i++) {
        color = parseInt(colors[i].substring(1), 16);
        out.push([
            (color >> 16) & 0xff,
            (color >> 8) & 0xff,
            color & 0xff
        ]);
    }
    return out;
})();
Terminal.defaults = {
    colors: Terminal.colors,
    theme: 'default',
    convertEol: false,
    termName: 'xterm',
    geometry: [80, 24],
    cursorBlink: false,
    visualBell: false,
    popOnBell: false,
    scrollback: 1000,
    screenKeys: false,
    debug: false,
    cancelEvents: false,
    disableStdin: false
};
Terminal.options = {};
Terminal.focus = null;
each(keys(Terminal.defaults), function (key) {
    Terminal[key] = Terminal.defaults[key];
    Terminal.options[key] = Terminal.defaults[key];
});
Terminal.prototype.focus = function () {
    return this.textarea.focus();
};
Terminal.prototype.getOption = function (key, value) {
    if (!(key in Terminal.defaults)) {
        throw new Error('No option with key "' + key + '"');
    }
    if (typeof this.options[key] !== 'undefined') {
        return this.options[key];
    }
    return this[key];
};
Terminal.prototype.setOption = function (key, value) {
    if (!(key in Terminal.defaults)) {
        throw new Error('No option with key "' + key + '"');
    }
    switch (key) {
        case 'scrollback':
            if (this.options[key] !== value) {
                if (this.lines.length > value) {
                    var amountToTrim = this.lines.length - value;
                    var needsRefresh = (this.ydisp - amountToTrim < 0);
                    this.lines.trimStart(amountToTrim);
                    this.ybase = Math.max(this.ybase - amountToTrim, 0);
                    this.ydisp = Math.max(this.ydisp - amountToTrim, 0);
                    if (needsRefresh) {
                        this.refresh(0, this.rows - 1);
                    }
                }
                this.lines.maxLength = value;
                this.viewport.syncScrollArea();
            }
            break;
    }
    this[key] = value;
    this.options[key] = value;
    switch (key) {
        case 'cursorBlink':
            this.element.classList.toggle('xterm-cursor-blink', value);
            break;
    }
};
Terminal.bindFocus = function (term) {
    on(term.textarea, 'focus', function (ev) {
        if (term.sendFocus) {
            term.send(EscapeSequences_1.C0.ESC + '[I');
        }
        term.element.classList.add('focus');
        term.showCursor();
        Terminal.focus = term;
        term.emit('focus', { terminal: term });
    });
};
Terminal.prototype.blur = function () {
    return this.textarea.blur();
};
Terminal.bindBlur = function (term) {
    on(term.textarea, 'blur', function (ev) {
        term.queueRefresh(term.y, term.y);
        if (term.sendFocus) {
            term.send(EscapeSequences_1.C0.ESC + '[O');
        }
        term.element.classList.remove('focus');
        Terminal.focus = null;
        term.emit('blur', { terminal: term });
    });
};
Terminal.prototype.initGlobal = function () {
    var term = this;
    Terminal.bindKeys(this);
    Terminal.bindFocus(this);
    Terminal.bindBlur(this);
    on(this.element, 'copy', function (ev) {
        Clipboard_1.copyHandler.call(this, ev, term);
    });
    on(this.textarea, 'paste', function (ev) {
        Clipboard_1.pasteHandler.call(this, ev, term);
    });
    on(this.element, 'paste', function (ev) {
        Clipboard_1.pasteHandler.call(this, ev, term);
    });
    function rightClickHandlerWrapper(ev) {
        Clipboard_1.rightClickHandler.call(this, ev, term);
    }
    if (term.browser.isFirefox) {
        on(this.element, 'mousedown', function (ev) {
            if (ev.button == 2) {
                rightClickHandlerWrapper(ev);
            }
        });
    }
    else {
        on(this.element, 'contextmenu', rightClickHandlerWrapper);
    }
};
Terminal.bindKeys = function (term) {
    on(term.element, 'keydown', function (ev) {
        if (document.activeElement != this) {
            return;
        }
        term.keyDown(ev);
    }, true);
    on(term.element, 'keypress', function (ev) {
        if (document.activeElement != this) {
            return;
        }
        term.keyPress(ev);
    }, true);
    on(term.element, 'keyup', function (ev) {
        if (!wasMondifierKeyOnlyEvent(ev)) {
            term.focus(term);
        }
    }, true);
    on(term.textarea, 'keydown', function (ev) {
        term.keyDown(ev);
    }, true);
    on(term.textarea, 'keypress', function (ev) {
        term.keyPress(ev);
        this.value = '';
    }, true);
    on(term.textarea, 'compositionstart', term.compositionHelper.compositionstart.bind(term.compositionHelper));
    on(term.textarea, 'compositionupdate', term.compositionHelper.compositionupdate.bind(term.compositionHelper));
    on(term.textarea, 'compositionend', term.compositionHelper.compositionend.bind(term.compositionHelper));
    term.on('refresh', term.compositionHelper.updateCompositionElements.bind(term.compositionHelper));
};
Terminal.prototype.insertRow = function (row) {
    if (typeof row != 'object') {
        row = document.createElement('div');
    }
    this.rowContainer.appendChild(row);
    this.children.push(row);
    return row;
};
Terminal.prototype.open = function (parent) {
    var self = this, i = 0, div;
    this.parent = parent || this.parent;
    if (!this.parent) {
        throw new Error('Terminal requires a parent element.');
    }
    this.context = this.parent.ownerDocument.defaultView;
    this.document = this.parent.ownerDocument;
    this.body = this.document.getElementsByTagName('body')[0];
    this.element = this.document.createElement('div');
    this.element.classList.add('terminal');
    this.element.classList.add('xterm');
    this.element.classList.add('xterm-theme-' + this.theme);
    this.element.classList.toggle('xterm-cursor-blink', this.options.cursorBlink);
    this.element.style.height;
    this.element.setAttribute('tabindex', 0);
    this.viewportElement = document.createElement('div');
    this.viewportElement.classList.add('xterm-viewport');
    this.element.appendChild(this.viewportElement);
    this.viewportScrollArea = document.createElement('div');
    this.viewportScrollArea.classList.add('xterm-scroll-area');
    this.viewportElement.appendChild(this.viewportScrollArea);
    this.rowContainer = document.createElement('div');
    this.rowContainer.classList.add('xterm-rows');
    this.element.appendChild(this.rowContainer);
    this.children = [];
    this.helperContainer = document.createElement('div');
    this.helperContainer.classList.add('xterm-helpers');
    this.element.appendChild(this.helperContainer);
    this.textarea = document.createElement('textarea');
    this.textarea.classList.add('xterm-helper-textarea');
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('spellcheck', 'false');
    this.textarea.tabIndex = 0;
    this.textarea.addEventListener('focus', function () {
        self.emit('focus', { terminal: self });
    });
    this.textarea.addEventListener('blur', function () {
        self.emit('blur', { terminal: self });
    });
    this.helperContainer.appendChild(this.textarea);
    this.compositionView = document.createElement('div');
    this.compositionView.classList.add('composition-view');
    this.compositionHelper = new CompositionHelper_1.CompositionHelper(this.textarea, this.compositionView, this);
    this.helperContainer.appendChild(this.compositionView);
    this.charSizeStyleElement = document.createElement('style');
    this.helperContainer.appendChild(this.charSizeStyleElement);
    for (; i < this.rows; i++) {
        this.insertRow();
    }
    this.parent.appendChild(this.element);
    this.charMeasure = new CharMeasure_1.CharMeasure(this.helperContainer);
    this.charMeasure.on('charsizechanged', function () {
        self.updateCharSizeCSS();
    });
    this.charMeasure.measure();
    this.viewport = new Viewport_1.Viewport(this, this.viewportElement, this.viewportScrollArea, this.charMeasure);
    this.queueRefresh(0, this.rows - 1);
    this.refreshLoop();
    this.initGlobal();
    this.focus();
    on(this.element, 'click', function () {
        var selection = document.getSelection(), collapsed = selection.isCollapsed, isRange = typeof collapsed == 'boolean' ? !collapsed : selection.type == 'Range';
        if (!isRange) {
            self.focus();
        }
    });
    this.bindMouse();
    if (Terminal.brokenBold == null) {
        Terminal.brokenBold = isBoldBroken(this.document);
    }
    this.emit('open');
};
Terminal.loadAddon = function (addon, callback) {
    if (typeof exports === 'object' && typeof module === 'object') {
        return require('./addons/' + addon + '/' + addon);
    }
    else if (typeof define == 'function') {
        return require(['./addons/' + addon + '/' + addon], callback);
    }
    else {
        console.error('Cannot load a module without a CommonJS or RequireJS environment.');
        return false;
    }
};
Terminal.prototype.updateCharSizeCSS = function () {
    this.charSizeStyleElement.textContent = '.xterm-wide-char{width:' + (this.charMeasure.width * 2) + 'px;}';
};
Terminal.prototype.bindMouse = function () {
    var el = this.element, self = this, pressed = 32;
    function sendButton(ev) {
        var button, pos;
        button = getButton(ev);
        pos = getCoords(ev);
        if (!pos)
            return;
        sendEvent(button, pos);
        switch (ev.overrideType || ev.type) {
            case 'mousedown':
                pressed = button;
                break;
            case 'mouseup':
                pressed = 32;
                break;
            case 'wheel':
                break;
        }
    }
    function sendMove(ev) {
        var button = pressed, pos;
        pos = getCoords(ev);
        if (!pos)
            return;
        button += 32;
        sendEvent(button, pos);
    }
    function encode(data, ch) {
        if (!self.utfMouse) {
            if (ch === 255)
                return data.push(0);
            if (ch > 127)
                ch = 127;
            data.push(ch);
        }
        else {
            if (ch === 2047)
                return data.push(0);
            if (ch < 127) {
                data.push(ch);
            }
            else {
                if (ch > 2047)
                    ch = 2047;
                data.push(0xC0 | (ch >> 6));
                data.push(0x80 | (ch & 0x3F));
            }
        }
    }
    function sendEvent(button, pos) {
        if (self.vt300Mouse) {
            button &= 3;
            pos.x -= 32;
            pos.y -= 32;
            var data = EscapeSequences_1.C0.ESC + '[24';
            if (button === 0)
                data += '1';
            else if (button === 1)
                data += '3';
            else if (button === 2)
                data += '5';
            else if (button === 3)
                return;
            else
                data += '0';
            data += '~[' + pos.x + ',' + pos.y + ']\r';
            self.send(data);
            return;
        }
        if (self.decLocator) {
            button &= 3;
            pos.x -= 32;
            pos.y -= 32;
            if (button === 0)
                button = 2;
            else if (button === 1)
                button = 4;
            else if (button === 2)
                button = 6;
            else if (button === 3)
                button = 3;
            self.send(EscapeSequences_1.C0.ESC + '['
                + button
                + ';'
                + (button === 3 ? 4 : 0)
                + ';'
                + pos.y
                + ';'
                + pos.x
                + ';'
                + (pos.page || 0)
                + '&w');
            return;
        }
        if (self.urxvtMouse) {
            pos.x -= 32;
            pos.y -= 32;
            pos.x++;
            pos.y++;
            self.send(EscapeSequences_1.C0.ESC + '[' + button + ';' + pos.x + ';' + pos.y + 'M');
            return;
        }
        if (self.sgrMouse) {
            pos.x -= 32;
            pos.y -= 32;
            self.send(EscapeSequences_1.C0.ESC + '[<'
                + (((button & 3) === 3 ? button & ~3 : button) - 32)
                + ';'
                + pos.x
                + ';'
                + pos.y
                + ((button & 3) === 3 ? 'm' : 'M'));
            return;
        }
        var data = [];
        encode(data, button);
        encode(data, pos.x);
        encode(data, pos.y);
        self.send(EscapeSequences_1.C0.ESC + '[M' + String.fromCharCode.apply(String, data));
    }
    function getButton(ev) {
        var button, shift, meta, ctrl, mod;
        switch (ev.overrideType || ev.type) {
            case 'mousedown':
                button = ev.button != null
                    ? +ev.button
                    : ev.which != null
                        ? ev.which - 1
                        : null;
                if (self.browser.isMSIE) {
                    button = button === 1 ? 0 : button === 4 ? 1 : button;
                }
                break;
            case 'mouseup':
                button = 3;
                break;
            case 'DOMMouseScroll':
                button = ev.detail < 0
                    ? 64
                    : 65;
                break;
            case 'wheel':
                button = ev.wheelDeltaY > 0
                    ? 64
                    : 65;
                break;
        }
        shift = ev.shiftKey ? 4 : 0;
        meta = ev.metaKey ? 8 : 0;
        ctrl = ev.ctrlKey ? 16 : 0;
        mod = shift | meta | ctrl;
        if (self.vt200Mouse) {
            mod &= ctrl;
        }
        else if (!self.normalMouse) {
            mod = 0;
        }
        button = (32 + (mod << 2)) + button;
        return button;
    }
    function getCoords(ev) {
        var x, y, w, h, el;
        if (ev.pageX == null)
            return;
        x = ev.pageX;
        y = ev.pageY;
        el = self.element;
        while (el && el !== self.document.documentElement) {
            x -= el.offsetLeft;
            y -= el.offsetTop;
            el = 'offsetParent' in el
                ? el.offsetParent
                : el.parentNode;
        }
        w = self.element.clientWidth;
        h = self.element.clientHeight;
        x = Math.ceil((x / w) * self.cols);
        y = Math.ceil((y / h) * self.rows);
        if (x < 0)
            x = 0;
        if (x > self.cols)
            x = self.cols;
        if (y < 0)
            y = 0;
        if (y > self.rows)
            y = self.rows;
        x += 32;
        y += 32;
        return {
            x: x,
            y: y,
            type: 'wheel'
        };
    }
    on(el, 'mousedown', function (ev) {
        if (!self.mouseEvents)
            return;
        sendButton(ev);
        self.focus();
        if (self.vt200Mouse) {
            ev.overrideType = 'mouseup';
            sendButton(ev);
            return self.cancel(ev);
        }
        if (self.normalMouse)
            on(self.document, 'mousemove', sendMove);
        if (!self.x10Mouse) {
            on(self.document, 'mouseup', function up(ev) {
                sendButton(ev);
                if (self.normalMouse)
                    off(self.document, 'mousemove', sendMove);
                off(self.document, 'mouseup', up);
                return self.cancel(ev);
            });
        }
        return self.cancel(ev);
    });
    on(el, 'wheel', function (ev) {
        if (!self.mouseEvents)
            return;
        if (self.x10Mouse
            || self.vt300Mouse
            || self.decLocator)
            return;
        sendButton(ev);
        return self.cancel(ev);
    });
    on(el, 'wheel', function (ev) {
        if (self.mouseEvents)
            return;
        self.viewport.onWheel(ev);
        return self.cancel(ev);
    });
};
Terminal.prototype.destroy = function () {
    this.readable = false;
    this.writable = false;
    this._events = {};
    this.handler = function () { };
    this.write = function () { };
    if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
    }
};
Terminal.flags = {
    BOLD: 1,
    UNDERLINE: 2,
    BLINK: 4,
    INVERSE: 8,
    INVISIBLE: 16
};
Terminal.prototype.queueRefresh = function (start, end) {
    this.refreshRowsQueue.push({ start: start, end: end });
};
Terminal.prototype.refreshLoop = function () {
    if (this.refreshRowsQueue.length > 0) {
        var skipFrame = this.writeBuffer.length > 0 && this.refreshFramesSkipped++ <= MAX_REFRESH_FRAME_SKIP;
        if (!skipFrame) {
            this.refreshFramesSkipped = 0;
            var start;
            var end;
            if (this.refreshRowsQueue.length > 4) {
                start = 0;
                end = this.rows - 1;
            }
            else {
                start = this.refreshRowsQueue[0].start;
                end = this.refreshRowsQueue[0].end;
                for (var i = 1; i < this.refreshRowsQueue.length; i++) {
                    if (this.refreshRowsQueue[i].start < start) {
                        start = this.refreshRowsQueue[i].start;
                    }
                    if (this.refreshRowsQueue[i].end > end) {
                        end = this.refreshRowsQueue[i].end;
                    }
                }
            }
            this.refreshRowsQueue = [];
            this.refresh(start, end);
        }
    }
    window.requestAnimationFrame(this.refreshLoop.bind(this));
};
Terminal.prototype.refresh = function (start, end) {
    var self = this;
    var x, y, i, line, out, ch, ch_width, width, data, attr, bg, fg, flags, row, parent, focused = document.activeElement;
    if (end - start >= this.rows / 2) {
        parent = this.element.parentNode;
        if (parent) {
            this.element.removeChild(this.rowContainer);
        }
    }
    width = this.cols;
    y = start;
    if (end >= this.rows.length) {
        this.log('`end` is too large. Most likely a bad CSR.');
        end = this.rows.length - 1;
    }
    for (; y <= end; y++) {
        row = y + this.ydisp;
        line = this.lines.get(row);
        if (!line || !this.children[y]) {
            continue;
        }
        out = '';
        if (this.y === y - (this.ybase - this.ydisp)
            && this.cursorState
            && !this.cursorHidden) {
            x = this.x;
        }
        else {
            x = -1;
        }
        attr = this.defAttr;
        i = 0;
        for (; i < width; i++) {
            if (!line[i]) {
                continue;
            }
            data = line[i][0];
            ch = line[i][1];
            ch_width = line[i][2];
            if (!ch_width)
                continue;
            if (i === x)
                data = -1;
            if (data !== attr) {
                if (attr !== this.defAttr) {
                    out += '</span>';
                }
                if (data !== this.defAttr) {
                    if (data === -1) {
                        out += '<span class="reverse-video terminal-cursor">';
                    }
                    else {
                        var classNames = [];
                        bg = data & 0x1ff;
                        fg = (data >> 9) & 0x1ff;
                        flags = data >> 18;
                        if (flags & Terminal.flags.BOLD) {
                            if (!Terminal.brokenBold) {
                                classNames.push('xterm-bold');
                            }
                            if (fg < 8)
                                fg += 8;
                        }
                        if (flags & Terminal.flags.UNDERLINE) {
                            classNames.push('xterm-underline');
                        }
                        if (flags & Terminal.flags.BLINK) {
                            classNames.push('xterm-blink');
                        }
                        if (flags & Terminal.flags.INVERSE) {
                            bg = [fg, fg = bg][0];
                            if ((flags & 1) && fg < 8)
                                fg += 8;
                        }
                        if (flags & Terminal.flags.INVISIBLE) {
                            classNames.push('xterm-hidden');
                        }
                        if (flags & Terminal.flags.INVERSE) {
                            if (bg == 257) {
                                bg = 15;
                            }
                            if (fg == 256) {
                                fg = 0;
                            }
                        }
                        if (bg < 256) {
                            classNames.push('xterm-bg-color-' + bg);
                        }
                        if (fg < 256) {
                            classNames.push('xterm-color-' + fg);
                        }
                        out += '<span';
                        if (classNames.length) {
                            out += ' class="' + classNames.join(' ') + '"';
                        }
                        out += '>';
                    }
                }
            }
            if (ch_width === 2) {
                out += '<span class="xterm-wide-char">';
            }
            switch (ch) {
                case '&':
                    out += '&amp;';
                    break;
                case '<':
                    out += '&lt;';
                    break;
                case '>':
                    out += '&gt;';
                    break;
                default:
                    if (ch <= ' ') {
                        out += '&nbsp;';
                    }
                    else {
                        out += ch;
                    }
                    break;
            }
            if (ch_width === 2) {
                out += '</span>';
            }
            attr = data;
        }
        if (attr !== this.defAttr) {
            out += '</span>';
        }
        this.children[y].innerHTML = out;
    }
    if (parent) {
        this.element.appendChild(this.rowContainer);
    }
    this.emit('refresh', { element: this.element, start: start, end: end });
};
Terminal.prototype.showCursor = function () {
    if (!this.cursorState) {
        this.cursorState = 1;
        this.queueRefresh(this.y, this.y);
    }
};
Terminal.prototype.scroll = function () {
    var row;
    if (this.lines.length === this.lines.maxLength) {
        this.lines.trimStart(1);
        this.ybase--;
        if (this.ydisp !== 0) {
            this.ydisp--;
        }
    }
    this.ybase++;
    if (!this.userScrolling) {
        this.ydisp = this.ybase;
    }
    row = this.ybase + this.rows - 1;
    row -= this.rows - 1 - this.scrollBottom;
    if (row === this.lines.length) {
        this.lines.push(this.blankLine());
    }
    else {
        this.lines.splice(row, 0, this.blankLine());
    }
    if (this.scrollTop !== 0) {
        if (this.ybase !== 0) {
            this.ybase--;
            if (!this.userScrolling) {
                this.ydisp = this.ybase;
            }
        }
        this.lines.splice(this.ybase + this.scrollTop, 1);
    }
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
    this.emit('scroll', this.ydisp);
};
Terminal.prototype.scrollDisp = function (disp, suppressScrollEvent) {
    if (disp < 0) {
        this.userScrolling = true;
    }
    else if (disp + this.ydisp >= this.ybase) {
        this.userScrolling = false;
    }
    this.ydisp += disp;
    if (this.ydisp > this.ybase) {
        this.ydisp = this.ybase;
    }
    else if (this.ydisp < 0) {
        this.ydisp = 0;
    }
    if (!suppressScrollEvent) {
        this.emit('scroll', this.ydisp);
    }
    this.queueRefresh(0, this.rows - 1);
};
Terminal.prototype.scrollPages = function (pageCount) {
    this.scrollDisp(pageCount * (this.rows - 1));
};
Terminal.prototype.scrollToTop = function () {
    this.scrollDisp(-this.ydisp);
};
Terminal.prototype.scrollToBottom = function () {
    this.scrollDisp(this.ybase - this.ydisp);
};
Terminal.prototype.write = function (data) {
    this.writeBuffer.push(data);
    if (!this.xoffSentToCatchUp && this.writeBuffer.length >= WRITE_BUFFER_PAUSE_THRESHOLD) {
        this.send(EscapeSequences_1.C0.DC3);
        this.xoffSentToCatchUp = true;
    }
    if (!this.writeInProgress && this.writeBuffer.length > 0) {
        this.writeInProgress = true;
        var self = this;
        setTimeout(function () {
            self.innerWrite();
        });
    }
};
Terminal.prototype.innerWrite = function () {
    var writeBatch = this.writeBuffer.splice(0, WRITE_BATCH_SIZE);
    while (writeBatch.length > 0) {
        var data = writeBatch.shift();
        var l = data.length, i = 0, j, cs, ch, code, low, ch_width, row;
        if (this.xoffSentToCatchUp && writeBatch.length === 0 && this.writeBuffer.length === 0) {
            this.send(EscapeSequences_1.C0.DC1);
            this.xoffSentToCatchUp = false;
        }
        this.refreshStart = this.y;
        this.refreshEnd = this.y;
        if (this.surrogate_high) {
            data = this.surrogate_high + data;
            this.surrogate_high = '';
        }
        for (; i < l; i++) {
            ch = data[i];
            code = data.charCodeAt(i);
            if (0xD800 <= code && code <= 0xDBFF) {
                low = data.charCodeAt(i + 1);
                if (isNaN(low)) {
                    this.surrogate_high = ch;
                    continue;
                }
                code = ((code - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;
                ch += data.charAt(i + 1);
            }
            if (0xDC00 <= code && code <= 0xDFFF)
                continue;
            switch (this.state) {
                case normal:
                    switch (ch) {
                        case EscapeSequences_1.C0.BEL:
                            this.bell();
                            break;
                        case EscapeSequences_1.C0.LF:
                        case EscapeSequences_1.C0.VT:
                        case EscapeSequences_1.C0.FF:
                            if (this.convertEol) {
                                this.x = 0;
                            }
                            this.y++;
                            if (this.y > this.scrollBottom) {
                                this.y--;
                                this.scroll();
                            }
                            break;
                        case '\r':
                            this.x = 0;
                            break;
                        case EscapeSequences_1.C0.BS:
                            if (this.x > 0) {
                                this.x--;
                            }
                            break;
                        case EscapeSequences_1.C0.HT:
                            this.x = this.nextStop();
                            break;
                        case EscapeSequences_1.C0.SO:
                            this.setgLevel(1);
                            break;
                        case EscapeSequences_1.C0.SI:
                            this.setgLevel(0);
                            break;
                        case EscapeSequences_1.C0.ESC:
                            this.state = escaped;
                            break;
                        default:
                            ch_width = wcwidth(code);
                            if (ch >= ' ') {
                                if (this.charset && this.charset[ch]) {
                                    ch = this.charset[ch];
                                }
                                row = this.y + this.ybase;
                                if (!ch_width && this.x) {
                                    if (this.lines.get(row)[this.x - 1]) {
                                        if (!this.lines.get(row)[this.x - 1][2]) {
                                            if (this.lines.get(row)[this.x - 2])
                                                this.lines.get(row)[this.x - 2][1] += ch;
                                        }
                                        else {
                                            this.lines.get(row)[this.x - 1][1] += ch;
                                        }
                                        this.updateRange(this.y);
                                    }
                                    break;
                                }
                                if (this.x + ch_width - 1 >= this.cols) {
                                    if (this.wraparoundMode) {
                                        this.x = 0;
                                        this.y++;
                                        if (this.y > this.scrollBottom) {
                                            this.y--;
                                            this.scroll();
                                        }
                                    }
                                    else {
                                        this.x = this.cols - 1;
                                        if (ch_width === 2)
                                            continue;
                                    }
                                }
                                row = this.y + this.ybase;
                                if (this.insertMode) {
                                    for (var moves = 0; moves < ch_width; ++moves) {
                                        var removed = this.lines.get(this.y + this.ybase).pop();
                                        if (removed[2] === 0
                                            && this.lines.get(row)[this.cols - 2]
                                            && this.lines.get(row)[this.cols - 2][2] === 2)
                                            this.lines.get(row)[this.cols - 2] = [this.curAttr, ' ', 1];
                                        this.lines.get(row).splice(this.x, 0, [this.curAttr, ' ', 1]);
                                    }
                                }
                                this.lines.get(row)[this.x] = [this.curAttr, ch, ch_width];
                                this.x++;
                                this.updateRange(this.y);
                                if (ch_width === 2) {
                                    this.lines.get(row)[this.x] = [this.curAttr, '', 0];
                                    this.x++;
                                }
                            }
                            break;
                    }
                    break;
                case escaped:
                    switch (ch) {
                        case '[':
                            this.params = [];
                            this.currentParam = 0;
                            this.state = csi;
                            break;
                        case ']':
                            this.params = [];
                            this.currentParam = 0;
                            this.state = osc;
                            break;
                        case 'P':
                            this.params = [];
                            this.currentParam = 0;
                            this.state = dcs;
                            break;
                        case '_':
                            this.state = ignore;
                            break;
                        case '^':
                            this.state = ignore;
                            break;
                        case 'c':
                            this.reset();
                            break;
                        case 'E':
                            this.x = 0;
                            ;
                        case 'D':
                            this.index();
                            break;
                        case 'M':
                            this.reverseIndex();
                            break;
                        case '%':
                            this.setgLevel(0);
                            this.setgCharset(0, Terminal.charsets.US);
                            this.state = normal;
                            i++;
                            break;
                        case '(':
                        case ')':
                        case '*':
                        case '+':
                        case '-':
                        case '.':
                            switch (ch) {
                                case '(':
                                    this.gcharset = 0;
                                    break;
                                case ')':
                                    this.gcharset = 1;
                                    break;
                                case '*':
                                    this.gcharset = 2;
                                    break;
                                case '+':
                                    this.gcharset = 3;
                                    break;
                                case '-':
                                    this.gcharset = 1;
                                    break;
                                case '.':
                                    this.gcharset = 2;
                                    break;
                            }
                            this.state = charset;
                            break;
                        case '/':
                            this.gcharset = 3;
                            this.state = charset;
                            i--;
                            break;
                        case 'N':
                            break;
                        case 'O':
                            break;
                        case 'n':
                            this.setgLevel(2);
                            break;
                        case 'o':
                            this.setgLevel(3);
                            break;
                        case '|':
                            this.setgLevel(3);
                            break;
                        case '}':
                            this.setgLevel(2);
                            break;
                        case '~':
                            this.setgLevel(1);
                            break;
                        case '7':
                            this.saveCursor();
                            this.state = normal;
                            break;
                        case '8':
                            this.restoreCursor();
                            this.state = normal;
                            break;
                        case '#':
                            this.state = normal;
                            i++;
                            break;
                        case 'H':
                            this.tabSet();
                            break;
                        case '=':
                            this.log('Serial port requested application keypad.');
                            this.applicationKeypad = true;
                            this.viewport.syncScrollArea();
                            this.state = normal;
                            break;
                        case '>':
                            this.log('Switching back to normal keypad.');
                            this.applicationKeypad = false;
                            this.viewport.syncScrollArea();
                            this.state = normal;
                            break;
                        default:
                            this.state = normal;
                            this.error('Unknown ESC control: %s.', ch);
                            break;
                    }
                    break;
                case charset:
                    switch (ch) {
                        case '0':
                            cs = Terminal.charsets.SCLD;
                            break;
                        case 'A':
                            cs = Terminal.charsets.UK;
                            break;
                        case 'B':
                            cs = Terminal.charsets.US;
                            break;
                        case '4':
                            cs = Terminal.charsets.Dutch;
                            break;
                        case 'C':
                        case '5':
                            cs = Terminal.charsets.Finnish;
                            break;
                        case 'R':
                            cs = Terminal.charsets.French;
                            break;
                        case 'Q':
                            cs = Terminal.charsets.FrenchCanadian;
                            break;
                        case 'K':
                            cs = Terminal.charsets.German;
                            break;
                        case 'Y':
                            cs = Terminal.charsets.Italian;
                            break;
                        case 'E':
                        case '6':
                            cs = Terminal.charsets.NorwegianDanish;
                            break;
                        case 'Z':
                            cs = Terminal.charsets.Spanish;
                            break;
                        case 'H':
                        case '7':
                            cs = Terminal.charsets.Swedish;
                            break;
                        case '=':
                            cs = Terminal.charsets.Swiss;
                            break;
                        case '/':
                            cs = Terminal.charsets.ISOLatin;
                            i++;
                            break;
                        default:
                            cs = Terminal.charsets.US;
                            break;
                    }
                    this.setgCharset(this.gcharset, cs);
                    this.gcharset = null;
                    this.state = normal;
                    break;
                case osc:
                    if (ch === EscapeSequences_1.C0.ESC || ch === EscapeSequences_1.C0.BEL) {
                        if (ch === EscapeSequences_1.C0.ESC)
                            i++;
                        this.params.push(this.currentParam);
                        switch (this.params[0]) {
                            case 0:
                            case 1:
                            case 2:
                                if (this.params[1]) {
                                    this.title = this.params[1];
                                    this.handleTitle(this.title);
                                }
                                break;
                            case 3:
                                break;
                            case 4:
                            case 5:
                                break;
                            case 10:
                            case 11:
                            case 12:
                            case 13:
                            case 14:
                            case 15:
                            case 16:
                            case 17:
                            case 18:
                            case 19:
                                break;
                            case 46:
                                break;
                            case 50:
                                break;
                            case 51:
                                break;
                            case 52:
                                break;
                            case 104:
                            case 105:
                            case 110:
                            case 111:
                            case 112:
                            case 113:
                            case 114:
                            case 115:
                            case 116:
                            case 117:
                            case 118:
                                break;
                        }
                        this.params = [];
                        this.currentParam = 0;
                        this.state = normal;
                    }
                    else {
                        if (!this.params.length) {
                            if (ch >= '0' && ch <= '9') {
                                this.currentParam =
                                    this.currentParam * 10 + ch.charCodeAt(0) - 48;
                            }
                            else if (ch === ';') {
                                this.params.push(this.currentParam);
                                this.currentParam = '';
                            }
                        }
                        else {
                            this.currentParam += ch;
                        }
                    }
                    break;
                case csi:
                    if (ch === '?' || ch === '>' || ch === '!') {
                        this.prefix = ch;
                        break;
                    }
                    if (ch >= '0' && ch <= '9') {
                        this.currentParam = this.currentParam * 10 + ch.charCodeAt(0) - 48;
                        break;
                    }
                    if (ch === '$' || ch === '"' || ch === ' ' || ch === '\'') {
                        this.postfix = ch;
                        break;
                    }
                    this.params.push(this.currentParam);
                    this.currentParam = 0;
                    if (ch === ';')
                        break;
                    this.state = normal;
                    switch (ch) {
                        case 'A':
                            this.cursorUp(this.params);
                            break;
                        case 'B':
                            this.cursorDown(this.params);
                            break;
                        case 'C':
                            this.cursorForward(this.params);
                            break;
                        case 'D':
                            this.cursorBackward(this.params);
                            break;
                        case 'H':
                            this.cursorPos(this.params);
                            break;
                        case 'J':
                            this.eraseInDisplay(this.params);
                            break;
                        case 'K':
                            this.eraseInLine(this.params);
                            break;
                        case 'm':
                            if (!this.prefix) {
                                this.charAttributes(this.params);
                            }
                            break;
                        case 'n':
                            if (!this.prefix) {
                                this.deviceStatus(this.params);
                            }
                            break;
                        case '@':
                            this.insertChars(this.params);
                            break;
                        case 'E':
                            this.cursorNextLine(this.params);
                            break;
                        case 'F':
                            this.cursorPrecedingLine(this.params);
                            break;
                        case 'G':
                            this.cursorCharAbsolute(this.params);
                            break;
                        case 'L':
                            this.insertLines(this.params);
                            break;
                        case 'M':
                            this.deleteLines(this.params);
                            break;
                        case 'P':
                            this.deleteChars(this.params);
                            break;
                        case 'X':
                            this.eraseChars(this.params);
                            break;
                        case '`':
                            this.charPosAbsolute(this.params);
                            break;
                        case 'a':
                            this.HPositionRelative(this.params);
                            break;
                        case 'c':
                            this.sendDeviceAttributes(this.params);
                            break;
                        case 'd':
                            this.linePosAbsolute(this.params);
                            break;
                        case 'e':
                            this.VPositionRelative(this.params);
                            break;
                        case 'f':
                            this.HVPosition(this.params);
                            break;
                        case 'h':
                            this.setMode(this.params);
                            break;
                        case 'l':
                            this.resetMode(this.params);
                            break;
                        case 'r':
                            this.setScrollRegion(this.params);
                            break;
                        case 's':
                            this.saveCursor(this.params);
                            break;
                        case 'u':
                            this.restoreCursor(this.params);
                            break;
                        case 'I':
                            this.cursorForwardTab(this.params);
                            break;
                        case 'S':
                            this.scrollUp(this.params);
                            break;
                        case 'T':
                            if (this.params.length < 2 && !this.prefix) {
                                this.scrollDown(this.params);
                            }
                            break;
                        case 'Z':
                            this.cursorBackwardTab(this.params);
                            break;
                        case 'b':
                            this.repeatPrecedingCharacter(this.params);
                            break;
                        case 'g':
                            this.tabClear(this.params);
                            break;
                        case 'p':
                            switch (this.prefix) {
                                case '!':
                                    this.softReset(this.params);
                                    break;
                            }
                            break;
                        default:
                            this.error('Unknown CSI code: %s.', ch);
                            break;
                    }
                    this.prefix = '';
                    this.postfix = '';
                    break;
                case dcs:
                    if (ch === EscapeSequences_1.C0.ESC || ch === EscapeSequences_1.C0.BEL) {
                        if (ch === EscapeSequences_1.C0.ESC)
                            i++;
                        switch (this.prefix) {
                            case '':
                                break;
                            case '$q':
                                var pt = this.currentParam, valid = false;
                                switch (pt) {
                                    case '"q':
                                        pt = '0"q';
                                        break;
                                    case '"p':
                                        pt = '61"p';
                                        break;
                                    case 'r':
                                        pt = ''
                                            + (this.scrollTop + 1)
                                            + ';'
                                            + (this.scrollBottom + 1)
                                            + 'r';
                                        break;
                                    case 'm':
                                        pt = '0m';
                                        break;
                                    default:
                                        this.error('Unknown DCS Pt: %s.', pt);
                                        pt = '';
                                        break;
                                }
                                this.send(EscapeSequences_1.C0.ESC + 'P' + +valid + '$r' + pt + EscapeSequences_1.C0.ESC + '\\');
                                break;
                            case '+p':
                                break;
                            case '+q':
                                var pt = this.currentParam, valid = false;
                                this.send(EscapeSequences_1.C0.ESC + 'P' + +valid + '+r' + pt + EscapeSequences_1.C0.ESC + '\\');
                                break;
                            default:
                                this.error('Unknown DCS prefix: %s.', this.prefix);
                                break;
                        }
                        this.currentParam = 0;
                        this.prefix = '';
                        this.state = normal;
                    }
                    else if (!this.currentParam) {
                        if (!this.prefix && ch !== '$' && ch !== '+') {
                            this.currentParam = ch;
                        }
                        else if (this.prefix.length === 2) {
                            this.currentParam = ch;
                        }
                        else {
                            this.prefix += ch;
                        }
                    }
                    else {
                        this.currentParam += ch;
                    }
                    break;
                case ignore:
                    if (ch === EscapeSequences_1.C0.ESC || ch === EscapeSequences_1.C0.BEL) {
                        if (ch === EscapeSequences_1.C0.ESC)
                            i++;
                        this.state = normal;
                    }
                    break;
            }
        }
        this.updateRange(this.y);
        this.queueRefresh(this.refreshStart, this.refreshEnd);
    }
    if (this.writeBuffer.length > 0) {
        var self = this;
        setTimeout(function () {
            self.innerWrite();
        }, 0);
    }
    else {
        this.writeInProgress = false;
    }
};
Terminal.prototype.writeln = function (data) {
    this.write(data + '\r\n');
};
Terminal.prototype.attachCustomKeydownHandler = function (customKeydownHandler) {
    this.customKeydownHandler = customKeydownHandler;
};
Terminal.prototype.keyDown = function (ev) {
    if (this.customKeydownHandler && this.customKeydownHandler(ev) === false) {
        return false;
    }
    if (!this.compositionHelper.keydown.bind(this.compositionHelper)(ev)) {
        if (this.ybase !== this.ydisp) {
            this.scrollToBottom();
        }
        return false;
    }
    var self = this;
    var result = this.evaluateKeyEscapeSequence(ev);
    if (result.key === EscapeSequences_1.C0.DC3) {
        this.writeStopped = true;
    }
    else if (result.key === EscapeSequences_1.C0.DC1) {
        this.writeStopped = false;
    }
    if (result.scrollDisp) {
        this.scrollDisp(result.scrollDisp);
        return this.cancel(ev, true);
    }
    if (isThirdLevelShift(this, ev)) {
        return true;
    }
    if (result.cancel) {
        this.cancel(ev, true);
    }
    if (!result.key) {
        return true;
    }
    this.emit('keydown', ev);
    this.emit('key', result.key, ev);
    this.showCursor();
    this.handler(result.key);
    return this.cancel(ev, true);
};
Terminal.prototype.evaluateKeyEscapeSequence = function (ev) {
    var result = {
        cancel: false,
        key: undefined,
        scrollDisp: undefined
    };
    var modifiers = ev.shiftKey << 0 | ev.altKey << 1 | ev.ctrlKey << 2 | ev.metaKey << 3;
    switch (ev.keyCode) {
        case 8:
            if (ev.shiftKey) {
                result.key = EscapeSequences_1.C0.BS;
                break;
            }
            result.key = EscapeSequences_1.C0.DEL;
            break;
        case 9:
            if (ev.shiftKey) {
                result.key = EscapeSequences_1.C0.ESC + '[Z';
                break;
            }
            result.key = EscapeSequences_1.C0.HT;
            result.cancel = true;
            break;
        case 13:
            result.key = EscapeSequences_1.C0.CR;
            result.cancel = true;
            break;
        case 27:
            result.key = EscapeSequences_1.C0.ESC;
            result.cancel = true;
            break;
        case 37:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'D';
                if (result.key == EscapeSequences_1.C0.ESC + '[1;3D') {
                    result.key = (this.browser.isMac) ? EscapeSequences_1.C0.ESC + 'b' : EscapeSequences_1.C0.ESC + '[1;5D';
                }
            }
            else if (this.applicationCursor) {
                result.key = EscapeSequences_1.C0.ESC + 'OD';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[D';
            }
            break;
        case 39:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'C';
                if (result.key == EscapeSequences_1.C0.ESC + '[1;3C') {
                    result.key = (this.browser.isMac) ? EscapeSequences_1.C0.ESC + 'f' : EscapeSequences_1.C0.ESC + '[1;5C';
                }
            }
            else if (this.applicationCursor) {
                result.key = EscapeSequences_1.C0.ESC + 'OC';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[C';
            }
            break;
        case 38:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'A';
                if (result.key == EscapeSequences_1.C0.ESC + '[1;3A') {
                    result.key = EscapeSequences_1.C0.ESC + '[1;5A';
                }
            }
            else if (this.applicationCursor) {
                result.key = EscapeSequences_1.C0.ESC + 'OA';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[A';
            }
            break;
        case 40:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'B';
                if (result.key == EscapeSequences_1.C0.ESC + '[1;3B') {
                    result.key = EscapeSequences_1.C0.ESC + '[1;5B';
                }
            }
            else if (this.applicationCursor) {
                result.key = EscapeSequences_1.C0.ESC + 'OB';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[B';
            }
            break;
        case 45:
            if (!ev.shiftKey && !ev.ctrlKey) {
                result.key = EscapeSequences_1.C0.ESC + '[2~';
            }
            break;
        case 46:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[3;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[3~';
            }
            break;
        case 36:
            if (modifiers)
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'H';
            else if (this.applicationCursor)
                result.key = EscapeSequences_1.C0.ESC + 'OH';
            else
                result.key = EscapeSequences_1.C0.ESC + '[H';
            break;
        case 35:
            if (modifiers)
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'F';
            else if (this.applicationCursor)
                result.key = EscapeSequences_1.C0.ESC + 'OF';
            else
                result.key = EscapeSequences_1.C0.ESC + '[F';
            break;
        case 33:
            if (ev.shiftKey) {
                result.scrollDisp = -(this.rows - 1);
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[5~';
            }
            break;
        case 34:
            if (ev.shiftKey) {
                result.scrollDisp = this.rows - 1;
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[6~';
            }
            break;
        case 112:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'P';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + 'OP';
            }
            break;
        case 113:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'Q';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + 'OQ';
            }
            break;
        case 114:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'R';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + 'OR';
            }
            break;
        case 115:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[1;' + (modifiers + 1) + 'S';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + 'OS';
            }
            break;
        case 116:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[15;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[15~';
            }
            break;
        case 117:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[17;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[17~';
            }
            break;
        case 118:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[18;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[18~';
            }
            break;
        case 119:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[19;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[19~';
            }
            break;
        case 120:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[20;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[20~';
            }
            break;
        case 121:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[21;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[21~';
            }
            break;
        case 122:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[23;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[23~';
            }
            break;
        case 123:
            if (modifiers) {
                result.key = EscapeSequences_1.C0.ESC + '[24;' + (modifiers + 1) + '~';
            }
            else {
                result.key = EscapeSequences_1.C0.ESC + '[24~';
            }
            break;
        default:
            if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
                if (ev.keyCode >= 65 && ev.keyCode <= 90) {
                    result.key = String.fromCharCode(ev.keyCode - 64);
                }
                else if (ev.keyCode === 32) {
                    result.key = String.fromCharCode(0);
                }
                else if (ev.keyCode >= 51 && ev.keyCode <= 55) {
                    result.key = String.fromCharCode(ev.keyCode - 51 + 27);
                }
                else if (ev.keyCode === 56) {
                    result.key = String.fromCharCode(127);
                }
                else if (ev.keyCode === 219) {
                    result.key = String.fromCharCode(27);
                }
                else if (ev.keyCode === 220) {
                    result.key = String.fromCharCode(28);
                }
                else if (ev.keyCode === 221) {
                    result.key = String.fromCharCode(29);
                }
            }
            else if (!this.browser.isMac && ev.altKey && !ev.ctrlKey && !ev.metaKey) {
                if (ev.keyCode >= 65 && ev.keyCode <= 90) {
                    result.key = EscapeSequences_1.C0.ESC + String.fromCharCode(ev.keyCode + 32);
                }
                else if (ev.keyCode === 192) {
                    result.key = EscapeSequences_1.C0.ESC + '`';
                }
                else if (ev.keyCode >= 48 && ev.keyCode <= 57) {
                    result.key = EscapeSequences_1.C0.ESC + (ev.keyCode - 48);
                }
            }
            break;
    }
    return result;
};
Terminal.prototype.setgLevel = function (g) {
    this.glevel = g;
    this.charset = this.charsets[g];
};
Terminal.prototype.setgCharset = function (g, charset) {
    this.charsets[g] = charset;
    if (this.glevel === g) {
        this.charset = charset;
    }
};
Terminal.prototype.keyPress = function (ev) {
    var key;
    this.cancel(ev);
    if (ev.charCode) {
        key = ev.charCode;
    }
    else if (ev.which == null) {
        key = ev.keyCode;
    }
    else if (ev.which !== 0 && ev.charCode !== 0) {
        key = ev.which;
    }
    else {
        return false;
    }
    if (!key || ((ev.altKey || ev.ctrlKey || ev.metaKey) && !isThirdLevelShift(this, ev))) {
        return false;
    }
    key = String.fromCharCode(key);
    this.emit('keypress', key, ev);
    this.emit('key', key, ev);
    this.showCursor();
    this.handler(key);
    return false;
};
Terminal.prototype.send = function (data) {
    var self = this;
    if (!this.queue) {
        setTimeout(function () {
            self.handler(self.queue);
            self.queue = '';
        }, 1);
    }
    this.queue += data;
};
Terminal.prototype.bell = function () {
    if (!this.visualBell)
        return;
    var self = this;
    this.element.style.borderColor = 'white';
    setTimeout(function () {
        self.element.style.borderColor = '';
    }, 10);
    if (this.popOnBell)
        this.focus();
};
Terminal.prototype.log = function () {
    if (!this.debug)
        return;
    if (!this.context.console || !this.context.console.log)
        return;
    var args = Array.prototype.slice.call(arguments);
    this.context.console.log.apply(this.context.console, args);
};
Terminal.prototype.error = function () {
    if (!this.debug)
        return;
    if (!this.context.console || !this.context.console.error)
        return;
    var args = Array.prototype.slice.call(arguments);
    this.context.console.error.apply(this.context.console, args);
};
Terminal.prototype.resize = function (x, y) {
    var line, el, i, j, ch, addToY;
    if (x === this.cols && y === this.rows) {
        return;
    }
    if (x < 1)
        x = 1;
    if (y < 1)
        y = 1;
    j = this.cols;
    if (j < x) {
        ch = [this.defAttr, ' ', 1];
        i = this.lines.length;
        while (i--) {
            while (this.lines.get(i).length < x) {
                this.lines.get(i).push(ch);
            }
        }
    }
    else {
        i = this.lines.length;
        while (i--) {
            while (this.lines.get(i).length > x) {
                this.lines.get(i).pop();
            }
        }
    }
    this.setupStops(j);
    this.cols = x;
    j = this.rows;
    addToY = 0;
    if (j < y) {
        el = this.element;
        while (j++ < y) {
            if (this.lines.length < y + this.ybase) {
                if (this.ybase > 0 && this.lines.length <= this.ybase + this.y + addToY + 1) {
                    this.ybase--;
                    addToY++;
                    if (this.ydisp > 0) {
                        this.ydisp--;
                    }
                }
                else {
                    this.lines.push(this.blankLine());
                }
            }
            if (this.children.length < y) {
                this.insertRow();
            }
        }
    }
    else {
        while (j-- > y) {
            if (this.lines.length > y + this.ybase) {
                if (this.lines.length > this.ybase + this.y + 1) {
                    this.lines.pop();
                }
                else {
                    this.ybase++;
                    this.ydisp++;
                }
            }
            if (this.children.length > y) {
                el = this.children.shift();
                if (!el)
                    continue;
                el.parentNode.removeChild(el);
            }
        }
    }
    this.rows = y;
    if (this.y >= y) {
        this.y = y - 1;
    }
    if (addToY) {
        this.y += addToY;
    }
    if (this.x >= x) {
        this.x = x - 1;
    }
    this.scrollTop = 0;
    this.scrollBottom = y - 1;
    this.charMeasure.measure();
    this.queueRefresh(0, this.rows - 1);
    this.normal = null;
    this.geometry = [this.cols, this.rows];
    this.emit('resize', { terminal: this, cols: x, rows: y });
};
Terminal.prototype.updateRange = function (y) {
    if (y < this.refreshStart)
        this.refreshStart = y;
    if (y > this.refreshEnd)
        this.refreshEnd = y;
};
Terminal.prototype.maxRange = function () {
    this.refreshStart = 0;
    this.refreshEnd = this.rows - 1;
};
Terminal.prototype.setupStops = function (i) {
    if (i != null) {
        if (!this.tabs[i]) {
            i = this.prevStop(i);
        }
    }
    else {
        this.tabs = {};
        i = 0;
    }
    for (; i < this.cols; i += 8) {
        this.tabs[i] = true;
    }
};
Terminal.prototype.prevStop = function (x) {
    if (x == null)
        x = this.x;
    while (!this.tabs[--x] && x > 0)
        ;
    return x >= this.cols
        ? this.cols - 1
        : x < 0 ? 0 : x;
};
Terminal.prototype.nextStop = function (x) {
    if (x == null)
        x = this.x;
    while (!this.tabs[++x] && x < this.cols)
        ;
    return x >= this.cols
        ? this.cols - 1
        : x < 0 ? 0 : x;
};
Terminal.prototype.eraseRight = function (x, y) {
    var line = this.lines.get(this.ybase + y), ch = [this.eraseAttr(), ' ', 1];
    for (; x < this.cols; x++) {
        line[x] = ch;
    }
    this.updateRange(y);
};
Terminal.prototype.eraseLeft = function (x, y) {
    var line = this.lines.get(this.ybase + y), ch = [this.eraseAttr(), ' ', 1];
    x++;
    while (x--)
        line[x] = ch;
    this.updateRange(y);
};
Terminal.prototype.clear = function () {
    if (this.ybase === 0 && this.y === 0) {
        return;
    }
    this.lines.set(0, this.lines.get(this.ybase + this.y));
    this.lines.length = 1;
    this.ydisp = 0;
    this.ybase = 0;
    this.y = 0;
    for (var i = 1; i < this.rows; i++) {
        this.lines.push(this.blankLine());
    }
    this.queueRefresh(0, this.rows - 1);
    this.emit('scroll', this.ydisp);
};
Terminal.prototype.eraseLine = function (y) {
    this.eraseRight(0, y);
};
Terminal.prototype.blankLine = function (cur) {
    var attr = cur
        ? this.eraseAttr()
        : this.defAttr;
    var ch = [attr, ' ', 1], line = [], i = 0;
    for (; i < this.cols; i++) {
        line[i] = ch;
    }
    return line;
};
Terminal.prototype.ch = function (cur) {
    return cur
        ? [this.eraseAttr(), ' ', 1]
        : [this.defAttr, ' ', 1];
};
Terminal.prototype.is = function (term) {
    var name = this.termName;
    return (name + '').indexOf(term) === 0;
};
Terminal.prototype.handler = function (data) {
    if (this.options.disableStdin) {
        return;
    }
    if (this.ybase !== this.ydisp) {
        this.scrollToBottom();
    }
    this.emit('data', data);
};
Terminal.prototype.handleTitle = function (title) {
    this.emit('title', title);
};
Terminal.prototype.index = function () {
    this.y++;
    if (this.y > this.scrollBottom) {
        this.y--;
        this.scroll();
    }
    this.state = normal;
};
Terminal.prototype.reverseIndex = function () {
    var j;
    if (this.y === this.scrollTop) {
        this.lines.shiftElements(this.y + this.ybase, this.rows - 1, 1);
        this.lines.set(this.y + this.ybase, this.blankLine(true));
        this.updateRange(this.scrollTop);
        this.updateRange(this.scrollBottom);
    }
    else {
        this.y--;
    }
    this.state = normal;
};
Terminal.prototype.reset = function () {
    this.options.rows = this.rows;
    this.options.cols = this.cols;
    var customKeydownHandler = this.customKeydownHandler;
    Terminal.call(this, this.options);
    this.customKeydownHandler = customKeydownHandler;
    this.queueRefresh(0, this.rows - 1);
    this.viewport.syncScrollArea();
};
Terminal.prototype.tabSet = function () {
    this.tabs[this.x] = true;
    this.state = normal;
};
Terminal.prototype.cursorUp = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y -= param;
    if (this.y < 0)
        this.y = 0;
};
Terminal.prototype.cursorDown = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y += param;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
};
Terminal.prototype.cursorForward = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.x += param;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};
Terminal.prototype.cursorBackward = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.x -= param;
    if (this.x < 0)
        this.x = 0;
};
Terminal.prototype.cursorPos = function (params) {
    var row, col;
    row = params[0] - 1;
    if (params.length >= 2) {
        col = params[1] - 1;
    }
    else {
        col = 0;
    }
    if (row < 0) {
        row = 0;
    }
    else if (row >= this.rows) {
        row = this.rows - 1;
    }
    if (col < 0) {
        col = 0;
    }
    else if (col >= this.cols) {
        col = this.cols - 1;
    }
    this.x = col;
    this.y = row;
};
Terminal.prototype.eraseInDisplay = function (params) {
    var j;
    switch (params[0]) {
        case 0:
            this.eraseRight(this.x, this.y);
            j = this.y + 1;
            for (; j < this.rows; j++) {
                this.eraseLine(j);
            }
            break;
        case 1:
            this.eraseLeft(this.x, this.y);
            j = this.y;
            while (j--) {
                this.eraseLine(j);
            }
            break;
        case 2:
            j = this.rows;
            while (j--)
                this.eraseLine(j);
            break;
        case 3:
            ;
            break;
    }
};
Terminal.prototype.eraseInLine = function (params) {
    switch (params[0]) {
        case 0:
            this.eraseRight(this.x, this.y);
            break;
        case 1:
            this.eraseLeft(this.x, this.y);
            break;
        case 2:
            this.eraseLine(this.y);
            break;
    }
};
Terminal.prototype.charAttributes = function (params) {
    if (params.length === 1 && params[0] === 0) {
        this.curAttr = this.defAttr;
        return;
    }
    var l = params.length, i = 0, flags = this.curAttr >> 18, fg = (this.curAttr >> 9) & 0x1ff, bg = this.curAttr & 0x1ff, p;
    for (; i < l; i++) {
        p = params[i];
        if (p >= 30 && p <= 37) {
            fg = p - 30;
        }
        else if (p >= 40 && p <= 47) {
            bg = p - 40;
        }
        else if (p >= 90 && p <= 97) {
            p += 8;
            fg = p - 90;
        }
        else if (p >= 100 && p <= 107) {
            p += 8;
            bg = p - 100;
        }
        else if (p === 0) {
            flags = this.defAttr >> 18;
            fg = (this.defAttr >> 9) & 0x1ff;
            bg = this.defAttr & 0x1ff;
        }
        else if (p === 1) {
            flags |= 1;
        }
        else if (p === 4) {
            flags |= 2;
        }
        else if (p === 5) {
            flags |= 4;
        }
        else if (p === 7) {
            flags |= 8;
        }
        else if (p === 8) {
            flags |= 16;
        }
        else if (p === 22) {
            flags &= ~1;
        }
        else if (p === 24) {
            flags &= ~2;
        }
        else if (p === 25) {
            flags &= ~4;
        }
        else if (p === 27) {
            flags &= ~8;
        }
        else if (p === 28) {
            flags &= ~16;
        }
        else if (p === 39) {
            fg = (this.defAttr >> 9) & 0x1ff;
        }
        else if (p === 49) {
            bg = this.defAttr & 0x1ff;
        }
        else if (p === 38) {
            if (params[i + 1] === 2) {
                i += 2;
                fg = matchColor(params[i] & 0xff, params[i + 1] & 0xff, params[i + 2] & 0xff);
                if (fg === -1)
                    fg = 0x1ff;
                i += 2;
            }
            else if (params[i + 1] === 5) {
                i += 2;
                p = params[i] & 0xff;
                fg = p;
            }
        }
        else if (p === 48) {
            if (params[i + 1] === 2) {
                i += 2;
                bg = matchColor(params[i] & 0xff, params[i + 1] & 0xff, params[i + 2] & 0xff);
                if (bg === -1)
                    bg = 0x1ff;
                i += 2;
            }
            else if (params[i + 1] === 5) {
                i += 2;
                p = params[i] & 0xff;
                bg = p;
            }
        }
        else if (p === 100) {
            fg = (this.defAttr >> 9) & 0x1ff;
            bg = this.defAttr & 0x1ff;
        }
        else {
            this.error('Unknown SGR attribute: %d.', p);
        }
    }
    this.curAttr = (flags << 18) | (fg << 9) | bg;
};
Terminal.prototype.deviceStatus = function (params) {
    if (!this.prefix) {
        switch (params[0]) {
            case 5:
                this.send(EscapeSequences_1.C0.ESC + '[0n');
                break;
            case 6:
                this.send(EscapeSequences_1.C0.ESC + '['
                    + (this.y + 1)
                    + ';'
                    + (this.x + 1)
                    + 'R');
                break;
        }
    }
    else if (this.prefix === '?') {
        switch (params[0]) {
            case 6:
                this.send(EscapeSequences_1.C0.ESC + '[?'
                    + (this.y + 1)
                    + ';'
                    + (this.x + 1)
                    + 'R');
                break;
            case 15:
                break;
            case 25:
                break;
            case 26:
                break;
            case 53:
                break;
        }
    }
};
Terminal.prototype.insertChars = function (params) {
    var param, row, j, ch;
    param = params[0];
    if (param < 1)
        param = 1;
    row = this.y + this.ybase;
    j = this.x;
    ch = [this.eraseAttr(), ' ', 1];
    while (param-- && j < this.cols) {
        this.lines.get(row).splice(j++, 0, ch);
        this.lines.get(row).pop();
    }
};
Terminal.prototype.cursorNextLine = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y += param;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
    this.x = 0;
};
Terminal.prototype.cursorPrecedingLine = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y -= param;
    if (this.y < 0)
        this.y = 0;
    this.x = 0;
};
Terminal.prototype.cursorCharAbsolute = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.x = param - 1;
};
Terminal.prototype.insertLines = function (params) {
    var param, row, j;
    param = params[0];
    if (param < 1)
        param = 1;
    row = this.y + this.ybase;
    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j + 1;
    while (param--) {
        if (this.lines.length === this.lines.maxLength) {
            this.lines.trimStart(1);
            this.ybase--;
            this.ydisp--;
            row--;
            j--;
        }
        this.lines.splice(row, 0, this.blankLine(true));
        this.lines.splice(j, 1);
    }
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
};
Terminal.prototype.deleteLines = function (params) {
    var param, row, j;
    param = params[0];
    if (param < 1)
        param = 1;
    row = this.y + this.ybase;
    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j;
    while (param--) {
        if (this.lines.length === this.lines.maxLength) {
            this.lines.trimStart(1);
            this.ybase -= 1;
            this.ydisp -= 1;
        }
        this.lines.splice(j + 1, 0, this.blankLine(true));
        this.lines.splice(row, 1);
    }
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
};
Terminal.prototype.deleteChars = function (params) {
    var param, row, ch;
    param = params[0];
    if (param < 1)
        param = 1;
    row = this.y + this.ybase;
    ch = [this.eraseAttr(), ' ', 1];
    while (param--) {
        this.lines.get(row).splice(this.x, 1);
        this.lines.get(row).push(ch);
    }
};
Terminal.prototype.eraseChars = function (params) {
    var param, row, j, ch;
    param = params[0];
    if (param < 1)
        param = 1;
    row = this.y + this.ybase;
    j = this.x;
    ch = [this.eraseAttr(), ' ', 1];
    while (param-- && j < this.cols) {
        this.lines.get(row)[j++] = ch;
    }
};
Terminal.prototype.charPosAbsolute = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.x = param - 1;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};
Terminal.prototype.HPositionRelative = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.x += param;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};
Terminal.prototype.sendDeviceAttributes = function (params) {
    if (params[0] > 0)
        return;
    if (!this.prefix) {
        if (this.is('xterm')
            || this.is('rxvt-unicode')
            || this.is('screen')) {
            this.send(EscapeSequences_1.C0.ESC + '[?1;2c');
        }
        else if (this.is('linux')) {
            this.send(EscapeSequences_1.C0.ESC + '[?6c');
        }
    }
    else if (this.prefix === '>') {
        if (this.is('xterm')) {
            this.send(EscapeSequences_1.C0.ESC + '[>0;276;0c');
        }
        else if (this.is('rxvt-unicode')) {
            this.send(EscapeSequences_1.C0.ESC + '[>85;95;0c');
        }
        else if (this.is('linux')) {
            this.send(params[0] + 'c');
        }
        else if (this.is('screen')) {
            this.send(EscapeSequences_1.C0.ESC + '[>83;40003;0c');
        }
    }
};
Terminal.prototype.linePosAbsolute = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y = param - 1;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
};
Terminal.prototype.VPositionRelative = function (params) {
    var param = params[0];
    if (param < 1)
        param = 1;
    this.y += param;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
};
Terminal.prototype.HVPosition = function (params) {
    if (params[0] < 1)
        params[0] = 1;
    if (params[1] < 1)
        params[1] = 1;
    this.y = params[0] - 1;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
    this.x = params[1] - 1;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};
Terminal.prototype.setMode = function (params) {
    if (typeof params === 'object') {
        var l = params.length, i = 0;
        for (; i < l; i++) {
            this.setMode(params[i]);
        }
        return;
    }
    if (!this.prefix) {
        switch (params) {
            case 4:
                this.insertMode = true;
                break;
            case 20:
                break;
        }
    }
    else if (this.prefix === '?') {
        switch (params) {
            case 1:
                this.applicationCursor = true;
                break;
            case 2:
                this.setgCharset(0, Terminal.charsets.US);
                this.setgCharset(1, Terminal.charsets.US);
                this.setgCharset(2, Terminal.charsets.US);
                this.setgCharset(3, Terminal.charsets.US);
                break;
            case 3:
                this.savedCols = this.cols;
                this.resize(132, this.rows);
                break;
            case 6:
                this.originMode = true;
                break;
            case 7:
                this.wraparoundMode = true;
                break;
            case 12:
                break;
            case 66:
                this.log('Serial port requested application keypad.');
                this.applicationKeypad = true;
                this.viewport.syncScrollArea();
                break;
            case 9:
            case 1000:
            case 1002:
            case 1003:
                this.x10Mouse = params === 9;
                this.vt200Mouse = params === 1000;
                this.normalMouse = params > 1000;
                this.mouseEvents = true;
                this.element.style.cursor = 'default';
                this.log('Binding to mouse events.');
                break;
            case 1004:
                this.sendFocus = true;
                break;
            case 1005:
                this.utfMouse = true;
                break;
            case 1006:
                this.sgrMouse = true;
                break;
            case 1015:
                this.urxvtMouse = true;
                break;
            case 25:
                this.cursorHidden = false;
                break;
            case 1049:
                ;
            case 47:
            case 1047:
                if (!this.normal) {
                    var normal = {
                        lines: this.lines,
                        ybase: this.ybase,
                        ydisp: this.ydisp,
                        x: this.x,
                        y: this.y,
                        scrollTop: this.scrollTop,
                        scrollBottom: this.scrollBottom,
                        tabs: this.tabs
                    };
                    this.reset();
                    this.viewport.syncScrollArea();
                    this.normal = normal;
                    this.showCursor();
                }
                break;
        }
    }
};
Terminal.prototype.resetMode = function (params) {
    if (typeof params === 'object') {
        var l = params.length, i = 0;
        for (; i < l; i++) {
            this.resetMode(params[i]);
        }
        return;
    }
    if (!this.prefix) {
        switch (params) {
            case 4:
                this.insertMode = false;
                break;
            case 20:
                break;
        }
    }
    else if (this.prefix === '?') {
        switch (params) {
            case 1:
                this.applicationCursor = false;
                break;
            case 3:
                if (this.cols === 132 && this.savedCols) {
                    this.resize(this.savedCols, this.rows);
                }
                delete this.savedCols;
                break;
            case 6:
                this.originMode = false;
                break;
            case 7:
                this.wraparoundMode = false;
                break;
            case 12:
                break;
            case 66:
                this.log('Switching back to normal keypad.');
                this.applicationKeypad = false;
                this.viewport.syncScrollArea();
                break;
            case 9:
            case 1000:
            case 1002:
            case 1003:
                this.x10Mouse = false;
                this.vt200Mouse = false;
                this.normalMouse = false;
                this.mouseEvents = false;
                this.element.style.cursor = '';
                break;
            case 1004:
                this.sendFocus = false;
                break;
            case 1005:
                this.utfMouse = false;
                break;
            case 1006:
                this.sgrMouse = false;
                break;
            case 1015:
                this.urxvtMouse = false;
                break;
            case 25:
                this.cursorHidden = true;
                break;
            case 1049:
                ;
            case 47:
            case 1047:
                if (this.normal) {
                    this.lines = this.normal.lines;
                    this.ybase = this.normal.ybase;
                    this.ydisp = this.normal.ydisp;
                    this.x = this.normal.x;
                    this.y = this.normal.y;
                    this.scrollTop = this.normal.scrollTop;
                    this.scrollBottom = this.normal.scrollBottom;
                    this.tabs = this.normal.tabs;
                    this.normal = null;
                    this.queueRefresh(0, this.rows - 1);
                    this.viewport.syncScrollArea();
                    this.showCursor();
                }
                break;
        }
    }
};
Terminal.prototype.setScrollRegion = function (params) {
    if (this.prefix)
        return;
    this.scrollTop = (params[0] || 1) - 1;
    this.scrollBottom = (params[1] || this.rows) - 1;
    this.x = 0;
    this.y = 0;
};
Terminal.prototype.saveCursor = function (params) {
    this.savedX = this.x;
    this.savedY = this.y;
};
Terminal.prototype.restoreCursor = function (params) {
    this.x = this.savedX || 0;
    this.y = this.savedY || 0;
};
Terminal.prototype.cursorForwardTab = function (params) {
    var param = params[0] || 1;
    while (param--) {
        this.x = this.nextStop();
    }
};
Terminal.prototype.scrollUp = function (params) {
    var param = params[0] || 1;
    while (param--) {
        this.lines.splice(this.ybase + this.scrollTop, 1);
        this.lines.splice(this.ybase + this.scrollBottom, 0, this.blankLine());
    }
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
};
Terminal.prototype.scrollDown = function (params) {
    var param = params[0] || 1;
    while (param--) {
        this.lines.splice(this.ybase + this.scrollBottom, 1);
        this.lines.splice(this.ybase + this.scrollTop, 0, this.blankLine());
    }
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
};
Terminal.prototype.initMouseTracking = function (params) {
};
Terminal.prototype.resetTitleModes = function (params) {
    ;
};
Terminal.prototype.cursorBackwardTab = function (params) {
    var param = params[0] || 1;
    while (param--) {
        this.x = this.prevStop();
    }
};
Terminal.prototype.repeatPrecedingCharacter = function (params) {
    var param = params[0] || 1, line = this.lines.get(this.ybase + this.y), ch = line[this.x - 1] || [this.defAttr, ' ', 1];
    while (param--)
        line[this.x++] = ch;
};
Terminal.prototype.tabClear = function (params) {
    var param = params[0];
    if (param <= 0) {
        delete this.tabs[this.x];
    }
    else if (param === 3) {
        this.tabs = {};
    }
};
Terminal.prototype.mediaCopy = function (params) {
    ;
};
Terminal.prototype.setResources = function (params) {
    ;
};
Terminal.prototype.disableModifiers = function (params) {
    ;
};
Terminal.prototype.setPointerMode = function (params) {
    ;
};
Terminal.prototype.softReset = function (params) {
    this.cursorHidden = false;
    this.insertMode = false;
    this.originMode = false;
    this.wraparoundMode = false;
    this.applicationKeypad = false;
    this.viewport.syncScrollArea();
    this.applicationCursor = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.curAttr = this.defAttr;
    this.x = this.y = 0;
    this.charset = null;
    this.glevel = 0;
    this.charsets = [null];
};
Terminal.prototype.requestAnsiMode = function (params) {
    ;
};
Terminal.prototype.requestPrivateMode = function (params) {
    ;
};
Terminal.prototype.setConformanceLevel = function (params) {
    ;
};
Terminal.prototype.loadLEDs = function (params) {
    ;
};
Terminal.prototype.setCursorStyle = function (params) {
    ;
};
Terminal.prototype.setCharProtectionAttr = function (params) {
    ;
};
Terminal.prototype.restorePrivateValues = function (params) {
    ;
};
Terminal.prototype.setAttrInRectangle = function (params) {
    var t = params[0], l = params[1], b = params[2], r = params[3], attr = params[4];
    var line, i;
    for (; t < b + 1; t++) {
        line = this.lines.get(this.ybase + t);
        for (i = l; i < r; i++) {
            line[i] = [attr, line[i][1]];
        }
    }
    this.updateRange(params[0]);
    this.updateRange(params[2]);
};
Terminal.prototype.fillRectangle = function (params) {
    var ch = params[0], t = params[1], l = params[2], b = params[3], r = params[4];
    var line, i;
    for (; t < b + 1; t++) {
        line = this.lines.get(this.ybase + t);
        for (i = l; i < r; i++) {
            line[i] = [line[i][0], String.fromCharCode(ch)];
        }
    }
    this.updateRange(params[1]);
    this.updateRange(params[3]);
};
Terminal.prototype.enableLocatorReporting = function (params) {
    var val = params[0] > 0;
};
Terminal.prototype.eraseRectangle = function (params) {
    var t = params[0], l = params[1], b = params[2], r = params[3];
    var line, i, ch;
    ch = [this.eraseAttr(), ' ', 1];
    for (; t < b + 1; t++) {
        line = this.lines.get(this.ybase + t);
        for (i = l; i < r; i++) {
            line[i] = ch;
        }
    }
    this.updateRange(params[0]);
    this.updateRange(params[2]);
};
Terminal.prototype.insertColumns = function () {
    var param = params[0], l = this.ybase + this.rows, ch = [this.eraseAttr(), ' ', 1], i;
    while (param--) {
        for (i = this.ybase; i < l; i++) {
            this.lines.get(i).splice(this.x + 1, 0, ch);
            this.lines.get(i).pop();
        }
    }
    this.maxRange();
};
Terminal.prototype.deleteColumns = function () {
    var param = params[0], l = this.ybase + this.rows, ch = [this.eraseAttr(), ' ', 1], i;
    while (param--) {
        for (i = this.ybase; i < l; i++) {
            this.lines.get(i).splice(this.x, 1);
            this.lines.get(i).push(ch);
        }
    }
    this.maxRange();
};
function wasMondifierKeyOnlyEvent(ev) {
    return ev.keyCode === 16 ||
        ev.keyCode === 17 ||
        ev.keyCode === 18;
}
Terminal.charsets = {};
Terminal.charsets.SCLD = {
    '`': '\u25c6',
    'a': '\u2592',
    'b': '\u0009',
    'c': '\u000c',
    'd': '\u000d',
    'e': '\u000a',
    'f': '\u00b0',
    'g': '\u00b1',
    'h': '\u2424',
    'i': '\u000b',
    'j': '\u2518',
    'k': '\u2510',
    'l': '\u250c',
    'm': '\u2514',
    'n': '\u253c',
    'o': '\u23ba',
    'p': '\u23bb',
    'q': '\u2500',
    'r': '\u23bc',
    's': '\u23bd',
    't': '\u251c',
    'u': '\u2524',
    'v': '\u2534',
    'w': '\u252c',
    'x': '\u2502',
    'y': '\u2264',
    'z': '\u2265',
    '{': '\u03c0',
    '|': '\u2260',
    '}': '\u00a3',
    '~': '\u00b7'
};
Terminal.charsets.UK = null;
Terminal.charsets.US = null;
Terminal.charsets.Dutch = null;
Terminal.charsets.Finnish = null;
Terminal.charsets.French = null;
Terminal.charsets.FrenchCanadian = null;
Terminal.charsets.German = null;
Terminal.charsets.Italian = null;
Terminal.charsets.NorwegianDanish = null;
Terminal.charsets.Spanish = null;
Terminal.charsets.Swedish = null;
Terminal.charsets.Swiss = null;
Terminal.charsets.ISOLatin = null;
function on(el, type, handler, capture) {
    if (!Array.isArray(el)) {
        el = [el];
    }
    el.forEach(function (element) {
        element.addEventListener(type, handler, capture || false);
    });
}
function off(el, type, handler, capture) {
    el.removeEventListener(type, handler, capture || false);
}
function cancel(ev, force) {
    if (!this.cancelEvents && !force) {
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    return false;
}
function inherits(child, parent) {
    function f() {
        this.constructor = child;
    }
    f.prototype = parent.prototype;
    child.prototype = new f;
}
function isBoldBroken(document) {
    var body = document.getElementsByTagName('body')[0];
    var el = document.createElement('span');
    el.innerHTML = 'hello world';
    body.appendChild(el);
    var w1 = el.scrollWidth;
    el.style.fontWeight = 'bold';
    var w2 = el.scrollWidth;
    body.removeChild(el);
    return w1 !== w2;
}
function indexOf(obj, el) {
    var i = obj.length;
    while (i--) {
        if (obj[i] === el)
            return i;
    }
    return -1;
}
function isThirdLevelShift(term, ev) {
    var thirdLevelKey = (term.browser.isMac && ev.altKey && !ev.ctrlKey && !ev.metaKey) ||
        (term.browser.isMSWindows && ev.altKey && ev.ctrlKey && !ev.metaKey);
    if (ev.type == 'keypress') {
        return thirdLevelKey;
    }
    return thirdLevelKey && (!ev.keyCode || ev.keyCode > 47);
}
function matchColor(r1, g1, b1) {
    var hash = (r1 << 16) | (g1 << 8) | b1;
    if (matchColor._cache[hash] != null) {
        return matchColor._cache[hash];
    }
    var ldiff = Infinity, li = -1, i = 0, c, r2, g2, b2, diff;
    for (; i < Terminal.vcolors.length; i++) {
        c = Terminal.vcolors[i];
        r2 = c[0];
        g2 = c[1];
        b2 = c[2];
        diff = matchColor.distance(r1, g1, b1, r2, g2, b2);
        if (diff === 0) {
            li = i;
            break;
        }
        if (diff < ldiff) {
            ldiff = diff;
            li = i;
        }
    }
    return matchColor._cache[hash] = li;
}
matchColor._cache = {};
matchColor.distance = function (r1, g1, b1, r2, g2, b2) {
    return Math.pow(30 * (r1 - r2), 2)
        + Math.pow(59 * (g1 - g2), 2)
        + Math.pow(11 * (b1 - b2), 2);
};
function each(obj, iter, con) {
    if (obj.forEach)
        return obj.forEach(iter, con);
    for (var i = 0; i < obj.length; i++) {
        iter.call(con, obj[i], i, obj);
    }
}
function keys(obj) {
    if (Object.keys)
        return Object.keys(obj);
    var key, keys = [];
    for (key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            keys.push(key);
        }
    }
    return keys;
}
var wcwidth = (function (opts) {
    var COMBINING = [
        [0x0300, 0x036F], [0x0483, 0x0486], [0x0488, 0x0489],
        [0x0591, 0x05BD], [0x05BF, 0x05BF], [0x05C1, 0x05C2],
        [0x05C4, 0x05C5], [0x05C7, 0x05C7], [0x0600, 0x0603],
        [0x0610, 0x0615], [0x064B, 0x065E], [0x0670, 0x0670],
        [0x06D6, 0x06E4], [0x06E7, 0x06E8], [0x06EA, 0x06ED],
        [0x070F, 0x070F], [0x0711, 0x0711], [0x0730, 0x074A],
        [0x07A6, 0x07B0], [0x07EB, 0x07F3], [0x0901, 0x0902],
        [0x093C, 0x093C], [0x0941, 0x0948], [0x094D, 0x094D],
        [0x0951, 0x0954], [0x0962, 0x0963], [0x0981, 0x0981],
        [0x09BC, 0x09BC], [0x09C1, 0x09C4], [0x09CD, 0x09CD],
        [0x09E2, 0x09E3], [0x0A01, 0x0A02], [0x0A3C, 0x0A3C],
        [0x0A41, 0x0A42], [0x0A47, 0x0A48], [0x0A4B, 0x0A4D],
        [0x0A70, 0x0A71], [0x0A81, 0x0A82], [0x0ABC, 0x0ABC],
        [0x0AC1, 0x0AC5], [0x0AC7, 0x0AC8], [0x0ACD, 0x0ACD],
        [0x0AE2, 0x0AE3], [0x0B01, 0x0B01], [0x0B3C, 0x0B3C],
        [0x0B3F, 0x0B3F], [0x0B41, 0x0B43], [0x0B4D, 0x0B4D],
        [0x0B56, 0x0B56], [0x0B82, 0x0B82], [0x0BC0, 0x0BC0],
        [0x0BCD, 0x0BCD], [0x0C3E, 0x0C40], [0x0C46, 0x0C48],
        [0x0C4A, 0x0C4D], [0x0C55, 0x0C56], [0x0CBC, 0x0CBC],
        [0x0CBF, 0x0CBF], [0x0CC6, 0x0CC6], [0x0CCC, 0x0CCD],
        [0x0CE2, 0x0CE3], [0x0D41, 0x0D43], [0x0D4D, 0x0D4D],
        [0x0DCA, 0x0DCA], [0x0DD2, 0x0DD4], [0x0DD6, 0x0DD6],
        [0x0E31, 0x0E31], [0x0E34, 0x0E3A], [0x0E47, 0x0E4E],
        [0x0EB1, 0x0EB1], [0x0EB4, 0x0EB9], [0x0EBB, 0x0EBC],
        [0x0EC8, 0x0ECD], [0x0F18, 0x0F19], [0x0F35, 0x0F35],
        [0x0F37, 0x0F37], [0x0F39, 0x0F39], [0x0F71, 0x0F7E],
        [0x0F80, 0x0F84], [0x0F86, 0x0F87], [0x0F90, 0x0F97],
        [0x0F99, 0x0FBC], [0x0FC6, 0x0FC6], [0x102D, 0x1030],
        [0x1032, 0x1032], [0x1036, 0x1037], [0x1039, 0x1039],
        [0x1058, 0x1059], [0x1160, 0x11FF], [0x135F, 0x135F],
        [0x1712, 0x1714], [0x1732, 0x1734], [0x1752, 0x1753],
        [0x1772, 0x1773], [0x17B4, 0x17B5], [0x17B7, 0x17BD],
        [0x17C6, 0x17C6], [0x17C9, 0x17D3], [0x17DD, 0x17DD],
        [0x180B, 0x180D], [0x18A9, 0x18A9], [0x1920, 0x1922],
        [0x1927, 0x1928], [0x1932, 0x1932], [0x1939, 0x193B],
        [0x1A17, 0x1A18], [0x1B00, 0x1B03], [0x1B34, 0x1B34],
        [0x1B36, 0x1B3A], [0x1B3C, 0x1B3C], [0x1B42, 0x1B42],
        [0x1B6B, 0x1B73], [0x1DC0, 0x1DCA], [0x1DFE, 0x1DFF],
        [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2063],
        [0x206A, 0x206F], [0x20D0, 0x20EF], [0x302A, 0x302F],
        [0x3099, 0x309A], [0xA806, 0xA806], [0xA80B, 0xA80B],
        [0xA825, 0xA826], [0xFB1E, 0xFB1E], [0xFE00, 0xFE0F],
        [0xFE20, 0xFE23], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB],
        [0x10A01, 0x10A03], [0x10A05, 0x10A06], [0x10A0C, 0x10A0F],
        [0x10A38, 0x10A3A], [0x10A3F, 0x10A3F], [0x1D167, 0x1D169],
        [0x1D173, 0x1D182], [0x1D185, 0x1D18B], [0x1D1AA, 0x1D1AD],
        [0x1D242, 0x1D244], [0xE0001, 0xE0001], [0xE0020, 0xE007F],
        [0xE0100, 0xE01EF]
    ];
    function bisearch(ucs) {
        var min = 0;
        var max = COMBINING.length - 1;
        var mid;
        if (ucs < COMBINING[0][0] || ucs > COMBINING[max][1])
            return false;
        while (max >= min) {
            mid = Math.floor((min + max) / 2);
            if (ucs > COMBINING[mid][1])
                min = mid + 1;
            else if (ucs < COMBINING[mid][0])
                max = mid - 1;
            else
                return true;
        }
        return false;
    }
    function wcwidth(ucs) {
        if (ucs === 0)
            return opts.nul;
        if (ucs < 32 || (ucs >= 0x7f && ucs < 0xa0))
            return opts.control;
        if (bisearch(ucs))
            return 0;
        return 1 +
            (ucs >= 0x1100 &&
                (ucs <= 0x115f ||
                    ucs == 0x2329 ||
                    ucs == 0x232a ||
                    (ucs >= 0x2e80 && ucs <= 0xa4cf && ucs != 0x303f) ||
                    (ucs >= 0xac00 && ucs <= 0xd7a3) ||
                    (ucs >= 0xf900 && ucs <= 0xfaff) ||
                    (ucs >= 0xfe10 && ucs <= 0xfe19) ||
                    (ucs >= 0xfe30 && ucs <= 0xfe6f) ||
                    (ucs >= 0xff00 && ucs <= 0xff60) ||
                    (ucs >= 0xffe0 && ucs <= 0xffe6) ||
                    (ucs >= 0x20000 && ucs <= 0x2fffd) ||
                    (ucs >= 0x30000 && ucs <= 0x3fffd)));
    }
    return wcwidth;
})({ nul: 0, control: 0 });
Terminal.EventEmitter = EventEmitter_1.EventEmitter;
Terminal.inherits = inherits;
Terminal.on = on;
Terminal.off = off;
Terminal.cancel = cancel;
module.exports = Terminal;

//# sourceMappingURL=xterm.js.map
