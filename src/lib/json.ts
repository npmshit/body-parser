/*!
 * body-parser
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * Copyright(c) 2018 Zongmin Lei <leizongmin@gmail.com>
 * MIT Licensed
 */

import { IOptionsJson, ServerRequest } from "./define";
import * as bytes from "../modules/bytes";
import * as createDebug from "@modernjs/debug";
import { IncomingMessage, ServerResponse } from "http";
const debug = createDebug("body-parser:json");

const contentType = require("content-type");
const createError = require("http-errors");
const read = require("../read");
const typeis = require("type-is");

/**
 * RegExp to match the first non-space in a string.
 *
 * Allowed whitespace is defined in RFC 7159:
 *
 *    ws = *(
 *            %x20 /              ; Space
 *            %x09 /              ; Horizontal tab
 *            %x0A /              ; Line feed or New line
 *            %x0D )              ; Carriage return
 */
const FIRST_CHAR_REGEXP = /^[\x20\x09\x0a\x0d]*(.)/; // eslint-disable-line no-control-regex

/**
 * Create a middleware to parse JSON bodies.
 *
 * @param {object} [options]
 * @return {function}
 */
export function json(options: IOptionsJson = {}) {
  const opts = options || {};

  const limit = typeof opts.limit !== "number" ? bytes.parse(opts.limit || "100kb") : opts.limit;
  const inflate = opts.inflate !== false;
  const reviver = opts.reviver;
  const strict = opts.strict !== false;
  const type = opts.type || "application/json";
  const verify = opts.verify || false;

  if (verify !== false && typeof verify !== "function") {
    throw new TypeError("option verify must be function");
  }

  // create the appropriate type checking function
  const shouldParse = typeof type !== "function" ? typeChecker(type) : type;

  function parse(body) {
    if (body.length === 0) {
      // special-case empty json body, as it's a common client-side mistake
      // TODO: maybe make this configurable or part of "strict" option
      return {};
    }

    if (strict) {
      const first = firstchar(body);

      if (first !== "{" && first !== "[") {
        debug("strict violation");
        throw createStrictSyntaxError(body, first);
      }
    }

    try {
      debug("parse json");
      return JSON.parse(body, reviver);
    } catch (e) {
      throw normalizeJsonSyntaxError(e, {
        message: e.message,
        stack: e.stack,
      });
    }
  }

  return function jsonParser(req: ServerRequest, res: ServerResponse, next: (err?: Error) => void) {
    if (req._body) {
      debug("body already parsed");
      next();
      return;
    }

    req.body = req.body || {};

    // skip requests without bodies
    if (!typeis.hasBody(req)) {
      debug("skip empty body");
      next();
      return;
    }

    debug("content-type %j", req.headers["content-type"]);

    // determine if request should be parsed
    if (!shouldParse(req)) {
      debug("skip parsing");
      next();
      return;
    }

    // assert charset per RFC 7159 sec 8.1
    const charset = getCharset(req) || "utf-8";
    if (charset.substr(0, 4) !== "utf-") {
      debug("invalid charset");
      next(
        createError(415, 'unsupported charset "' + charset.toUpperCase() + '"', {
          charset: charset,
          type: "charset.unsupported",
        }),
      );
      return;
    }

    // read
    read(req, res, next, parse, debug, {
      encoding: charset,
      inflate: inflate,
      limit: limit,
      verify: verify,
    });
  };
}

/**
 * Create strict violation syntax error matching native error.
 *
 * @param {string} str
 * @param {string} char
 * @return {Error}
 */
function createStrictSyntaxError(str: string, char: string) {
  const index = str.indexOf(char);
  const partial = str.substring(0, index) + "#";

  try {
    JSON.parse(partial);
    /* istanbul ignore next */ throw new SyntaxError("strict violation");
  } catch (e) {
    return normalizeJsonSyntaxError(e, {
      message: e.message.replace("#", char),
      stack: e.stack,
    });
  }
}

/**
 * Get the first non-whitespace character in a string.
 *
 * @param {string} str
 * @return {function}
 */
function firstchar(str: string) {
  return FIRST_CHAR_REGEXP.exec(str)![1];
}

/**
 * Get the charset of a request.
 *
 * @param {object} req
 */
function getCharset(req: IncomingMessage) {
  try {
    return (contentType.parse(req).parameters.charset || "").toLowerCase();
  } catch (e) {
    return undefined;
  }
}

/**
 * Normalize a SyntaxError for JSON.parse.
 *
 * @param {SyntaxError} error
 * @param {object} obj
 * @return {SyntaxError}
 */
function normalizeJsonSyntaxError(error: Error, obj: any) {
  const keys = Object.getOwnPropertyNames(error);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== "stack" && key !== "message") {
      delete (error as Record<string, any>)[key];
    }
  }

  // replace stack before message for Node.js 0.10 and below
  error.stack = obj.stack.replace(error.message, obj.message);
  error.message = obj.message;

  return error;
}

/**
 * Get the simple type checker.
 *
 * @param {string} type
 * @return {function}
 */
function typeChecker(type: string) {
  return function checkType(req: IncomingMessage) {
    return Boolean(typeis(req, type));
  };
}
