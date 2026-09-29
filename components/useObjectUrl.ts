import { useEffect, useMemo } from "react";

/** Creates an object URL for a blob and revokes it when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}
