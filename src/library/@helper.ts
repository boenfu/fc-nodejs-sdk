/* eslint-disable @typescript-eslint/prefer-for-of */

function buildCanonicalHeaders(
  headers: Record<string, string>,
  prefix: string,
): string {
  let list = [];
  let keys = Object.keys(headers);

  let fcHeaders: Record<string, string> = {};

  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];

    let lowerKey = key.toLowerCase().trim();

    if (lowerKey.startsWith(prefix)) {
      list.push(lowerKey);
      fcHeaders[lowerKey] = headers[key];
    }
  }

  list.sort();

  let canonical = '';

  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    canonical += `${key}:${fcHeaders[key]}\n`;
  }

  return canonical;
}

export function composeStringToSign(
  method: string,
  path: string,
  headers: Record<string, string>,
  queries: Record<string, any> | undefined,
): string {
  const contentMD5 = headers['content-md5'] || '';
  const contentType = headers['content-type'] || '';
  const date = headers['date'];
  const signHeaders = buildCanonicalHeaders(headers, 'x-fc-');

  const pathUnescaped = decodeURIComponent(path);
  let str = `${method}\n${contentMD5}\n${contentType}\n${date}\n${signHeaders}${pathUnescaped}`;

  if (queries) {
    let params: string[] = [];
    Object.keys(queries).forEach(function (key) {
      let values = queries[key];
      let type = typeof values;

      if (type === 'string') {
        params.push(`${key}=${values}`);
        return;
      }

      if (Array.isArray(values)) {
        (queries[key] as any[]).forEach(function (value) {
          params.push(`${key}=${value}`);
        });
      }
    });
    params.sort();
    str += `\n${params.join('\n')}`;
  }

  return str;
}
