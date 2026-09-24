declare module "x11" {
  import type { EventEmitter } from "node:events";
  import type { Socket } from "node:net";

  export interface X11Property {
    readonly type: number;
    readonly format: number;
    readonly bytesAfter: number;
    readonly data: Buffer;
  }

  export type X11Event = {
    readonly name: string;
    readonly wid?: number;
    readonly atom?: number;
  };

  export interface X11Display {
    readonly client: X11Client;
    readonly screen: readonly { readonly root: number }[];
  }

  export interface X11Client extends EventEmitter {
    on(event: "event", listener: (event: X11Event) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    readonly atoms: Readonly<Record<string, number>>;
    readonly stream?: { destroy(): void };
    InternAtom(onlyIfExists: boolean, name: string, callback: (error: Error | null, atom: number) => boolean | void): void;
    GetWindowAttributes(window: number, callback: (error: Error | null, attributes: { readonly mapState: number }) => boolean | void): void;
    GetGeometry(window: number, callback: (error: Error | null, geometry: { readonly windowid: number }) => boolean | void): void;
    ChangeWindowAttributes(window: number, values: { readonly eventMask: number }): void;
    GetProperty(deleteAfterRead: boolean, window: number, property: number, type: number, offset: number, length: number, callback: (error: Error | null, property: X11Property) => boolean | void): void;
    ChangeProperty(mode: number, window: number, property: number, type: number, format: number, data: readonly number[]): void;
    SendClientMessage(destination: number, window: number, messageType: number, format: number, data: readonly number[], eventMask: number, callback: (error: Error | null) => boolean | void): void;
    GetInputFocus(callback: (error: Error | null, focus: { readonly focus: number }) => boolean | void): void;
    readonly stream?: Socket;
    terminate(): void;
  }

  export function createClient(options: { readonly display: string; readonly stream: Socket; readonly auth: undefined; readonly shm: false }, callback: (error: Error | null, display: X11Display) => void): X11Client;
  export function parseDisplay(display: string): { readonly display: string; readonly protocol: string; readonly host: string; readonly displayNum: string; readonly screenNum: string };
  export const eventMask: {
    readonly StructureNotify: number;
    readonly PropertyChange: number;
  };
}
