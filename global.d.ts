declare module '*?raw' {
  const content: string;
  export default content;
}
declare module '*?url' {
  const content: string;
  export default content;
}
declare module '*.html' {
  const content: string;
  export default content;
}
declare module '*.md' {
  const content: string;
  export default content;
}
declare module '*.css' {
  const content: unknown;
  export default content;
}
declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

declare const YAML: typeof import('yaml');

declare const z: typeof import('zod');
declare namespace z {
  export type infer<T> = import('zod').infer<T>;
  export type input<T> = import('zod').input<T>;
  export type output<T> = import('zod').output<T>;
}

declare module 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js' {
  export function registerMvuSchema(
    schema: z.ZodType<Record<string, any>> | (() => z.ZodType<Record<string, any>>),
  ): void;
}

type LiteralUnion<T extends U, U = string> = T | (U & {});

type PartialDeep<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer U)[]
    ? readonly PartialDeep<U>[]
    : T extends (infer U)[]
      ? PartialDeep<U>[]
      : T extends object
        ? { [K in keyof T]?: PartialDeep<T[K]> }
        : T;

type SetRequired<BaseType, Keys extends keyof BaseType> = Omit<BaseType, Keys> & Required<Pick<BaseType, Keys>>;

declare function insertAudioList(...args: any[]): any;

declare function formatAsTavernRegexedString(
  text: string,
  source: 'user_input' | 'ai_output' | 'slash_command' | 'world_info' | 'reasoning',
  destination: 'display' | 'prompt',
  option?: { depth?: number; character_name?: string },
): string;

interface BluetoothLEScanFilter {
  services?: BluetoothServiceUUID[];
  name?: string;
  namePrefix?: string;
  manufacturerData?: Array<{
    companyIdentifier: number;
    dataPrefix?: BufferSource;
    mask?: BufferSource;
  }>;
  serviceData?: Array<{
    service: BluetoothServiceUUID;
    dataPrefix?: BufferSource;
    mask?: BufferSource;
  }>;
}

type BluetoothServiceUUID = number | string;

interface BluetoothRemoteGATTServer {
  readonly connected?: boolean;
}

interface BluetoothDevice {
  readonly id?: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer | null;
}
