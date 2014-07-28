/*jslint node: true */
'use strict';

var widgets = require('./widgets'),
    render = require('./render'),
    tag = require('./tag'),
    is = require('is'),
    async = require('async'),
    http = require('http'),
    querystring = require('qs'),
    parse = require('url').parse,
    formidable = require('formidable'),
    validators = require('./validators'),
    coerceArray = function (arr) {
        return Array.isArray(arr) && arr.length > 0 ? arr : [];
    },
    copy = function (original) {
        return Object.keys(original).reduce(function (copy, key) {
            copy[key] = original[key];
            return copy;
        }, {});
    },
    nameSeparatorRegExp = /[_-]/g;


exports.string = function (opt) {
    if (!opt) { opt = {}; }

    var f = copy(opt);
    f.widget = f.widget || widgets.text(opt.attrs || {});

    f.parse = function (raw_data) {
        if (typeof raw_data !== 'undefined' && raw_data !== null) {
            return String(raw_data);
        }
        return '';
    };
    f.bind = function (raw_data) {
        var b = copy(f); // clone field object:
        b.value = raw_data;
        b.data = b.parse(raw_data);
        b.validate = function (form, callback) {
            var forceValidation = (b.validators || []).some(function (validator) {
                return validator.forceValidation;
            });
            if (!forceValidation && (raw_data === '' || raw_data === null || typeof raw_data === 'undefined')) {
                // don't validate empty fields, but check if required
                if (b.required) {
                    var validator = is.fn(b.required) ? b.required : validators.required();
                    validator(form, b, function (v_err) {
                        b.error = v_err ? String(v_err) : null;
                        callback(v_err, b);
                    });
                } else {
                    process.nextTick(function () { callback(null, b); });
                }
            } else {
                async.forEachSeries(b.validators || [], function (v, callback) {
                    if (!b.error) {
                        v(form, b, function (v_err) {
                            b.error = v_err ? String(v_err) : null;
                            callback(null);
                        });
                    } else {
                        callback(null);
                    }
                }, function (err) {
                    callback(err, b);
                });
            }
        };
        return b;
    };
    f.errorHTML = function () {
        var classes = typeof this.cssClasses !== 'undefined' ? coerceArray(this.cssClasses.error) : [];
        return this.error ? tag('p', { classes: ['error_msg'].concat(classes) }, this.error) : '';
    };
    f.labelText = function (name) {
        var text = this.label;
        if (!text && name) {
            text = name.charAt(0).toUpperCase() + name.slice(1).replace(nameSeparatorRegExp, ' ').replace(/([a-z])([A-Z])/g, function (match, firstLetter, secondLetter) {
                return firstLetter + ' ' + secondLetter.toLowerCase();
            });
        }
        return text || '';
    };
    f.labelHTML = function (name, id) {
        if (this.widget.type === 'hidden') { return ''; }
        var forID = id === false ? false : (id || 'id_' + name);
        return widgets.label({
            classes: typeof this.cssClasses !== 'undefined' ? coerceArray(this.cssClasses.label) : [],
            content: this.labelText(name, id)
        }).toHTML(forID, f);
    };
    f.classes = function () {
        var r = ['field'];
        if (this.error) { r.push('error'); }
        if (this.required) { r.push('required'); }
        if (typeof this.cssClasses !== 'undefined') {
            r = r.concat(coerceArray(this.cssClasses.field));
        }
        return r;
    };
    f.toHTML = function (name, iterator) {
        return (iterator || render.div)(name || this.name, this, opt);
    };

    return f;
};

exports.number = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);

    f.parse = function (raw_data) {
        if (raw_data === null || raw_data === '') {
            return NaN;
        }
        return Number(raw_data);
    };
    return f;
};

exports.boolean = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);

    f.widget = opt.widget || widgets.checkbox(opt.attrs || {});
    f.parse = function (raw_data) {
        return !!raw_data;
    };
    return f;
};

exports.email = function (opt) {
    var opts = opt ? copy(opt) : {};
    if (!opts.widget) { opts.widget = widgets.email(opts.attrs || {}); }
    var f = exports.string(opts);
    if (f.validators) {
        f.validators.unshift(validators.email());
    } else {
        f.validators = [validators.email()];
    }
    return f;
};

exports.tel = function (opt) {
    var opts = opt ? copy(opt) : {};
    if (!opts.widget) { opts.widget = widgets.tel(opts.attrs || {}); }
    return exports.string(opts);
};

exports.password = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);
    f.widget = opt.widget || widgets.password(opt.attrs || {});
    return f;
};

exports.url = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);
    if (f.validators) {
        f.validators.unshift(validators.url());
    } else {
        f.validators = [validators.url()];
    }
    return f;
};

exports.array = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);
    f.parse = function (raw_data) {
        if (typeof raw_data === 'undefined') { return []; }
        return Array.isArray(raw_data) ? raw_data : [raw_data];
    };
    return f;
};

exports.date = function (opt) {
    if (!opt) { opt = {}; }
    var f = exports.string(opt);
    if (f.validators) {
        f.validators.unshift(validators.date());
    } else {
        f.validators = [validators.date()];
    }
    return f;
};

exports.create = function (fields, opts) {
    if (!opts) { opts = {}; }

    var validatePastFirstError = !!opts.validatePastFirstError;

    Object.keys(fields).forEach(function (k) {
        // if it's not a field object, create an object field.
        if (!is.fn(fields[k].toHTML) && is.object(fields[k])) {
            fields[k] = exports.fields.object(fields[k]);
        }
        fields[k].name = k;
    });
    var f = {
        fields: fields,
        bind: function (data) {
            var b = {};
            b.toHTML = f.toHTML;
            b.fields = {};
            Object.keys(f.fields).forEach(function (k) {
                if (data != null) {
                    b.fields[k] = f.fields[k].bind(data[k]);
                }
            });
            b.data = Object.keys(b.fields).reduce(function (a, k) {
                a[k] = b.fields[k].data;
                return a;
            }, {});
            b.validate = function (obj, callback) {
                if (arguments.length === 1) {
                    obj = callback;
                    callback = arguments[0];
                }

                async.forEach(Object.keys(b.fields), function (k, callback) {
                    b.fields[k].validate(b, function (err, bound_field) {
                        b.fields[k] = bound_field;
                        callback(validatePastFirstError ? null : err);
                    });
                }, function (err) {
                    callback(err, b);
                });
            };
            b.isValid = function () {
                var form = this;
                return Object.keys(form.fields).every(function (k) {
                    return form.fields[k].error === null || typeof form.fields[k].error === 'undefined';
                });
            };
            return b;
        },
        handle: function (obj, callbacks) {
            if (typeof obj === 'undefined' || obj === null || (is.object(obj) && is.empty(obj))) {
                (callbacks.empty || callbacks.other)(f, callbacks);
            } else if (obj instanceof http.IncomingMessage) {
                if (obj.method === 'GET') {
                    var qs = parse(obj.url).query;
                    f.handle(querystring.parse(qs), callbacks);
                } else if (obj.method === 'POST' || obj.method === 'PUT') {
                    // If the app is using bodyDecoder for connect or express,
                    // it has already put all the POST data into request.body.
                    if (obj.body) {
                        f.handle(obj.body, callbacks);
                    } else {
                        var form = new formidable.IncomingForm();
                        form.parse(obj, function (err, fields, files) {
                            if (err) { throw err; }
                            fields = querystring.parse(querystring.stringify(fields));
                            f.handle(fields, callbacks);
                        });
                    }
                } else {
                    throw new Error('Cannot handle request method: ' + obj.method);
                }
            } else if (is.object(obj)) {
                f.bind(obj).validate(function (err, f) {
                    if (f.isValid()) {
                        (callbacks.success || callbacks.other)(f, callbacks);
                    } else {
                        (callbacks.error || callbacks.other)(f, callbacks);
                    }
                });
            } else {
                throw new Error('Cannot handle type: ' + typeof obj);
            }
        },
        toHTML: function (name, iterator) {
            var form = this;

            if (arguments.length === 1) {
                name = iterator;
                iterator = arguments[0];
            }

            return Object.keys(form.fields).reduce(function (html, k) {
                var kname = is.string(name) ? name + '[' + k + ']' : k;
                return html + form.fields[k].toHTML(kname, iterator);
            }, '');
        }
    };
    return f;
};

exports.object = function (fields) {
    return exports.create(fields || {});
};

