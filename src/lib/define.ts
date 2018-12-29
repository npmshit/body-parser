import { IncomingMessage, ServerResponse } from "http";

export interface IOptions {
  inflate?: boolean;
  limit?: number | string;
  type?: string | string[] | ((req: IncomingMessage) => any);
  verify?(req: IncomingMessage, res: ServerResponse, buf: Buffer, encoding: string): void;
}

export interface IOptionsJson extends IOptions {
  reviver?(key: string, value: any): any;
  strict?: boolean;
}

export interface IOptionsText extends IOptions {
  defaultCharset?: string;
}

export interface IOptionsUrlencoded extends IOptions {
  extended?: boolean;
  parameterLimit?: number;
}

export interface ServerRequest extends IncomingMessage {
  _body?: boolean;
  body?: Record<string, any>;
}
