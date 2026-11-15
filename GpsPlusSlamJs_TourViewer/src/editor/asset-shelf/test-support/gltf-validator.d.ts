/** The part of the Khronos glTF validator's API the model tests use
 *  (the package ships no types). Test-only. */
declare module "gltf-validator" {
  export interface ValidatorMessage {
    readonly code: string;
    readonly message: string;
    /** 0 error, 1 warning, 2 info, 3 hint. */
    readonly severity: number;
    readonly pointer?: string;
  }
  export function validateBytes(
    bytes: Uint8Array,
    options?: { readonly ignoredIssues?: readonly string[] },
  ): Promise<{
    readonly issues: {
      readonly numErrors: number;
      readonly messages: readonly ValidatorMessage[];
    };
  }>;
}
