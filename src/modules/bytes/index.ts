/*!
 * bytes
 * Copyright(c) 2012-2014 TJ Holowaychuk
 * Copyright(c) 2015 Jed Watson
 * Copyright(c) 2018 Zongmin Lei <leizongmin@gmail.com>
 * MIT Licensed
 */

const formatThousandsRegExp = /\B(?=(\d{3})+(?!\d))/g;
const formatDecimalsRegExp = /(?:\.0*|(\.[^0]+)0+)$/;
const map = {
  b: 1,
  kb: 1 << 10,
  mb: 1 << 20,
  gb: 1 << 30,
  tb: (1 << 30) * 1024
};
const parseRegExp = /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb)$/i;

export interface IBytesOptions {
  decimalPlaces?: number;
  thousandsSeparator?: string;
  unitSeparator?: string;
  fixedDecimals?: boolean;
  unit?: string;
}

/**
 * Convert the given value in bytes into a string or parse to string to an integer in bytes.
 *
 * @param {string|number} value
 * @param {{
 *  case: [string],
 *  decimalPlaces: [number]
 *  fixedDecimals: [boolean]
 *  thousandsSeparator: [string]
 *  unitSeparator: [string]
 *  }} [options] bytes options.
 *
 * @returns {string|number|null}
 */

export function bytes(value: string | number, options: IBytesOptions = {}) {
  if (typeof value === "string") {
    return parse(value);
  }

  if (typeof value === "number") {
    return format(value, options);
  }

  return null;
}

/**
 * Format the given value in bytes into a string.
 *
 * If the value is negative, it is kept as such. If it is a float,
 * it is rounded.
 *
 * @param {number} value
 * @param {object} [options]
 * @param {number} [options.decimalPlaces=2]
 * @param {number} [options.fixedDecimals=false]
 * @param {string} [options.thousandsSeparator=]
 * @param {string} [options.unit=]
 * @param {string} [options.unitSeparator=]
 *
 * @returns {string|null}
 */
function format(value: number, options: IBytesOptions) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const mag = Math.abs(value);
  const thousandsSeparator = (options && options.thousandsSeparator) || "";
  const unitSeparator = (options && options.unitSeparator) || "";
  const decimalPlaces =
    options && options.decimalPlaces !== undefined ? options.decimalPlaces : 2;
  const fixedDecimals = Boolean(options && options.fixedDecimals);
  let unit = (options && options.unit) || "";

  if (!unit || !map[unit.toLowerCase()]) {
    if (mag >= map.tb) {
      unit = "TB";
    } else if (mag >= map.gb) {
      unit = "GB";
    } else if (mag >= map.mb) {
      unit = "MB";
    } else if (mag >= map.kb) {
      unit = "KB";
    } else {
      unit = "B";
    }
  }

  const val = value / map[unit.toLowerCase()];
  let str = val.toFixed(decimalPlaces);

  if (!fixedDecimals) {
    str = str.replace(formatDecimalsRegExp, "$1");
  }

  if (thousandsSeparator) {
    str = str.replace(formatThousandsRegExp, thousandsSeparator);
  }

  return str + unitSeparator + unit;
}

/**
 * Parse the string value into an integer in bytes.
 *
 * If no unit is given, it is assumed the value is in bytes.
 *
 * @param {number|string} val
 *
 * @returns {number|null}
 */
export function parse(val: string | number) {
  if (typeof val === "number" && !isNaN(val)) {
    return val;
  }

  if (typeof val !== "string") {
    return null;
  }

  // Test if the string passed is valid
  const results = parseRegExp.exec(val);
  let floatValue;
  let unit = "b";

  if (!results) {
    // Nothing could be extracted from the given string
    floatValue = parseInt(val, 10);
    unit = "b";
  } else {
    // Retrieve the value and the unit
    floatValue = parseFloat(results[1]);
    unit = results[4].toLowerCase();
  }

  return Math.floor(map[unit] * floatValue);
}
