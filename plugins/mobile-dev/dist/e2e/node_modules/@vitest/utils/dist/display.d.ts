import { PrettyFormatOptions } from '@vitest/pretty-format';

interface StringifyOptions extends PrettyFormatOptions {
	maxLength?: number;
	filterNode?: string | ((node: any) => boolean);
}
declare function stringify(object: unknown, maxDepth?: number, { maxLength, filterNode, ...options }?: StringifyOptions): string;
declare const formatRegExp: RegExp;
declare function format(args: unknown[], options?: InspectOptions): string;
interface InspectOptions extends StringifyOptions {
	truncate?: number;
	multiline?: boolean;
}
declare function inspect(obj: unknown, options?: InspectOptions): string;
declare function truncateString(string: string, maxLength: number): string;

export { format, formatRegExp, inspect, stringify, truncateString };
export type { InspectOptions, StringifyOptions };
