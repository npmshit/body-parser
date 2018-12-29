/*!
 * body-parser
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * Copyright(c) 2018 Zongmin Lei <leizongmin@gmail.com>
 * MIT Licensed
 */

const createError = require("http-errors");
const getBody = require("raw-body");

import * as zlib from "zlib";
import * as iconv from "iconv-lite";
import { onFinished } from "./utils";
import { ServerRequest } from "./define";
import { ServerResponse } from "http";

/**
 * Read a request into a buffer and parse.
 *
 * @param {object} req
 * @param {object} res
 * @param {function} next
 * @param {function} parse
 * @param {function} debug
 * @param {object} options
 */
export function read(
  req: ServerRequest,
  res: ServerResponse,
  next: (err?: Error) => void,
  parse: (arg0: any) => Record<string, any> | undefined,
  debug: (...args: any[]) => void,
  options: any,
) {
  let length;
  const opts = options;
  let stream: (zlib.Gunzip | ServerRequest) & { length?: string };

  // flag as parsed
  req._body = true;

  // read options
  const encoding = opts.encoding !== null ? opts.encoding : null;
  const verify = opts.verify;

  try {
    // get the content stream
    stream = contentstream(req, debug, opts.inflate);
    length = stream.length;
    stream.length = undefined;
  } catch (err) {
    return next(err);
  }

  // set raw-body options
  opts.length = length;
  opts.encoding = verify ? null : encoding;

  // assert charset is supported
  if (opts.encoding === null && encoding !== null && !iconv.encodingExists(encoding)) {
    return next(
      createError(415, 'unsupported charset "' + encoding.toUpperCase() + '"', {
        charset: encoding.toLowerCase(),
        type: "charset.unsupported",
      }),
    );
  }

  // read body
  debug("read body");
  getBody(stream, opts, function(error: Error, body) {
    if (error) {
      let _error: Error;

      if (error.type === "encoding.unsupported") {
        // echo back charset
        _error = createError(415, 'unsupported charset "' + encoding.toUpperCase() + '"', {
          charset: encoding.toLowerCase(),
          type: "charset.unsupported",
        });
      } else {
        // set status code on error
        _error = createError(400, error);
      }

      // read off entire request
      stream.resume();
      onFinished(req, function onfinished() {
        next(createError(400, _error));
      });
      return;
    }

    // verify
    if (verify) {
      try {
        debug("verify body");
        verify(req, res, body, encoding);
      } catch (err) {
        next(
          createError(403, err, {
            body: body,
            type: err.type || "entity.verify.failed",
          }),
        );
        return;
      }
    }

    // parse
    let str = body;
    try {
      debug("parse body");
      str = typeof body !== "string" && encoding !== null ? iconv.decode(body, encoding) : body;
      req.body = parse(str);
    } catch (err) {
      next(
        createError(400, err, {
          body: str,
          type: err.type || "entity.parse.failed",
        }),
      );
      return;
    }

    next();
  });
}

/**
 * Get the content stream of the request.
 *
 * @param {object} req
 * @param {function} debug
 * @param {boolean} [inflate=true]
 * @return {object}
 */
function contentstream(req: ServerRequest, debug: (...args: any[]) => void, inflate: boolean = true) {
  const encoding = (req.headers["content-encoding"] || "identity").toLowerCase();
  const length = req.headers["content-length"];
  let stream: (zlib.Gunzip | ServerRequest) & { length?: string };

  debug('content-encoding "%s"', encoding);

  if (inflate === false && encoding !== "identity") {
    throw createError(415, "content encoding unsupported", {
      encoding: encoding,
      type: "encoding.unsupported",
    });
  }

  switch (encoding) {
    case "deflate":
      stream = zlib.createInflate();
      debug("inflate body");
      req.pipe(stream);
      break;
    case "gzip":
      stream = zlib.createGunzip();
      debug("gunzip body");
      req.pipe(stream);
      break;
    case "identity":
      stream = req;
      stream.length = length;
      break;
    default:
      throw createError(415, 'unsupported content encoding "' + encoding + '"', {
        encoding: encoding,
        type: "encoding.unsupported",
      });
  }

  return stream;
}
