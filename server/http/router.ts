import { AppError } from './errors.js';
import type { Handler, HttpMethod, RouteOptions } from './types.js';

interface Route {
  method: HttpMethod;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
}

export interface MatchedRoute {
  handler: Handler;
  params: Record<string, string>;
  options: RouteOptions;
}

/** Minimal path router: `/customers/:id/activities`. */
export class Router {
  private routes: Route[] = [];

  add(method: HttpMethod, path: string, handler: Handler, options: RouteOptions = {}): this {
    this.routes.push({ method, segments: split(path), handler, options });
    return this;
  }

  get(path: string, handler: Handler, options?: RouteOptions) { return this.add('GET', path, handler, options); }
  post(path: string, handler: Handler, options?: RouteOptions) { return this.add('POST', path, handler, options); }
  patch(path: string, handler: Handler, options?: RouteOptions) { return this.add('PATCH', path, handler, options); }
  delete(path: string, handler: Handler, options?: RouteOptions) { return this.add('DELETE', path, handler, options); }

  match(method: HttpMethod, path: string): MatchedRoute {
    const segments = split(path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params, options: route.options };
    }
    throw pathMatched ? new AppError('METHOD_NOT_ALLOWED') : new AppError('NOT_FOUND', 'Unknown API route.');
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) {
      params[pattern[i].slice(1)] = decodeURIComponent(actual[i]);
    } else if (pattern[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}
