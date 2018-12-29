/*!
 * raw-body
 * Copyright(c) 2013-2014 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * Copyright(c) 2018 Zongmin Lei <leizongmin@gmail.com>
 * MIT Licensed
 */

import * as bytes from "../bytes";
import { createHttpError } from "../../lib/utils";
import * as iconv from "iconv-lite";
import { Readable } from "stream";

/**
 * Module variables.
 * @private
 */

const ICONV_ENCODING_MESSAGE_REGEXP = /^Encoding not recognized: /;

/**
 * Get the decoder for a given encoding.
 *
 * @param {string} encoding
 */
function getDecoder(encoding: string) {
  if (!encoding) return null;

  try {
    return iconv.getDecoder(encoding);
  } catch (e) {
    // error getting decoder
    if (!ICONV_ENCODING_MESSAGE_REGEXP.test(e.message)) throw e;

    // the encoding was not found
    throw createHttpError(415, "specified encoding unsupported", {
      encoding: encoding,
      type: "encoding.unsupported",
    });
  }
}

export interface IOptions {
  /**
   * The expected length of the stream.
   */
  length?: number | string | null;
  /**
   * The byte limit of the body. This is the number of bytes or any string
   * format supported by `bytes`, for example `1000`, `'500kb'` or `'3mb'`.
   */
  limit?: number | string | null;
  /**
   * The encoding to use to decode the body into a string. By default, a
   * `Buffer` instance will be returned when no encoding is specified. Most
   * likely, you want `utf-8`, so setting encoding to `true` will decode as
   * `utf-8`. You can use any type of encoding supported by `iconv-lite`.
   */
  encoding?: string | true | null;
}

/**
 * Get the raw body of a stream (typically HTTP).
 *
 * @param {object} stream
 * @param {object|string|function} [options]
 * @param {function} [callback]
 * @public
 */
export function getRawBody(stream: Readable, options: IOptions, callback) {
  const done = callback;
  let opts: IOptions = options || {};

  if (options === true || typeof options === "string") {
    // short cut for encoding
    opts = {
      encoding: options,
    };
  }

  if (typeof options === "function") {
    done = options;
    opts = {};
  }

  // validate callback is a function, if provided
  if (done !== undefined && typeof done !== "function") {
    throw new TypeError("argument callback must be a function");
  }

  // require the callback without promises
  if (!done && !global.Promise) {
    throw new TypeError("argument callback is required");
  }

  // get encoding
  const encoding = opts.encoding !== true ? opts.encoding : "utf-8";

  // convert the limit to an integer
  const limit = bytes.parse(opts.limit);

  // convert the expected length to an integer
  const length = opts.length != null && !isNaN(opts.length) ? parseInt(opts.length, 10) : null;

  if (done) {
    // classic callback style
    return readStream(stream, encoding, length, limit, done);
  }

  return new Promise(function executor(resolve, reject) {
    readStream(stream, encoding, length, limit, function onRead(err, buf) {
      if (err) return reject(err);
      resolve(buf);
    });
  });
}

/**
 * Halt a stream.
 *
 * @param {Object} stream
 * @private
 */

function halt(stream: any) {
  // unpipe everything from the stream
  if (typeof stream.unpipe === "function") {
    stream.unpipe();
  }

  // pause stream
  if (typeof stream.pause === "function") {
    stream.pause();
  }
}

/**
 * Read the data from the stream.
 *
 * @param {object} stream
 * @param {string} encoding
 * @param {number} length
 * @param {number} limit
 * @param {function} callback
 * @public
 */

function readStream(
  stream: Readable,
  encoding: string | null | undefined,
  length: number | null,
  limit: number | null,
  callback: (err?: any, buf?: any) => void,
) {
  const complete = false;
  const sync = true;

  // check the length and limit options.
  // note: we intentionally leave the stream paused,
  // so users should handle the stream themselves.
  if (limit !== null && length !== null && length > limit) {
    return done(
      createHttpError(413, new Error("request entity too large"), {
        expected: length,
        length: length,
        limit: limit,
        type: "entity.too.large",
      }),
    );
  }

  // streams1: assert request encoding is buffer.
  // streams2+: assert the stream encoding is buffer.
  //   stream._decoder: streams1
  //   state.encoding: streams2
  //   state.decoder: streams2, specifically < 0.10.6
  const state = (stream as any)._readableState;
  if ((stream as any)._decoder || (state && (state.encoding || state.decoder))) {
    // developer error
    return done(
      createHttpError(500, new Error("stream encoding should not be set"), {
        type: "stream.encoding.set",
      }),
    );
  }

  const received = 0;
  const decoder;

  try {
    decoder = getDecoder(encoding);
  } catch (err) {
    return done(err);
  }

  const buffer = decoder ? "" : [];

  // attach listeners
  stream.on("aborted", onAborted);
  stream.on("close", cleanup);
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onEnd);

  // mark sync section complete
  sync = false;

  function done(...args: any[]) {
    // copy arguments
    for (const i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }

    // mark complete
    complete = true;

    if (sync) {
      process.nextTick(invokeCallback);
    } else {
      invokeCallback();
    }

    function invokeCallback() {
      cleanup();

      if (args[0]) {
        // halt the stream on error
        halt(stream);
      }

      callback.apply(null, args);
    }
  }

  function onAborted() {
    if (complete) return;

    done(
      createHttpError(400, "request aborted", {
        code: "ECONNABORTED",
        expected: length,
        length: length,
        received: received,
        type: "request.aborted",
      }),
    );
  }

  function onData(chunk) {
    if (complete) return;

    received += chunk.length;

    if (limit !== null && received > limit) {
      done(
        createHttpError(413, "request entity too large", {
          limit: limit,
          received: received,
          type: "entity.too.large",
        }),
      );
    } else if (decoder) {
      buffer += decoder.write(chunk);
    } else {
      buffer.push(chunk);
    }
  }

  function onEnd(err) {
    if (complete) return;
    if (err) return done(err);

    if (length !== null && received !== length) {
      done(
        createHttpError(400, "request size did not match content length", {
          expected: length,
          length: length,
          received: received,
          type: "request.size.invalid",
        }),
      );
    } else {
      const string = decoder ? buffer + (decoder.end() || "") : Buffer.concat(buffer);
      done(null, string);
    }
  }

  function cleanup() {
    buffer = null;

    stream.removeListener("aborted", onAborted);
    stream.removeListener("data", onData);
    stream.removeListener("end", onEnd);
    stream.removeListener("error", onEnd);
    stream.removeListener("close", cleanup);
  }
}
