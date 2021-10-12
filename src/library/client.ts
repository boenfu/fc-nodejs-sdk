/* eslint-disable no-null/no-null */
/* eslint-disable @mufan/explicit-return-type */
import crypto from 'crypto';
import {IncomingHttpHeaders} from 'http';

import Debug from 'debug';
import httpx from 'httpx';
import kitx from 'kitx';

import {composeStringToSign} from './@helper';

const debug = Debug('lambda');

function signString(source: string, secret: string): string {
  const buff = crypto
    .createHmac('sha256', secret)
    .update(source, 'utf8')
    .digest();
  return Buffer.from(buff).toString('base64');
}

function getServiceName(serviceName: string, qualifier?: string): string {
  if (qualifier) {
    return `${serviceName}.${qualifier}`;
  }

  return serviceName;
}

type RequestQuery<T extends any = any> = Record<string, T>;

export interface RequestExtraOptions {
  rawBuf?: boolean;
}

export interface LogConfig {
  logstore: string;
  project: string;
  enableRequestMetrics: boolean;
}

export interface NASConfig {
  groupId: string;
  mountPoints: {
    mountDir: string;
    serverAddr: string;
  }[];
  userId: string;
}

export interface VPCConfig {
  securityGroupId: string;
  vSwitchIds: string[];
  vpcId: string;
}

export interface TracingConfig {
  type: string;
  params: Record<string, any>;
}

export interface CertConfig {
  certName: string;
  certificate: string;
  privateKey: string;
}

export interface PathConfig {
  functionName: string;
  methods: string[];
  path: string;
  qualifier: string;
  serviceName: string;
}

export interface RouteConfig {
  routes: PathConfig[];
}

export interface ServiceModifyOptions {
  description?: string;
  internetAccess?: boolean;
  logConfig?: LogConfig;
  nasConfig?: NASConfig;
  role?: string;
  vpcConfig?: VPCConfig;
  tracingConfig?: TracingConfig;
}

export interface FunctionOSSCode {
  ossBucketName: string;
  ossObjectName: string;
}

export interface FunctionFileCode {
  zipFile: string;
}

export type FunctionCode = FunctionOSSCode | FunctionFileCode;

export interface FunctionCustomContainerConfig {
  args: string;
  command: string;
  image: string;
  accelerationType: string;
  instanceID: string;
}

export interface FunctionModifyOptions {
  code?: FunctionCode;
  customContainerConfig?: FunctionCustomContainerConfig;
  layers?: string[];
  description?: string;
  functionName?: string;
  handler?: string;
  initializationTimeout?: number;
  initializer?: string;
  memorySize?: number;
  runtime?: string;
  timeout?: number;
  caPort?: number;
}

export interface TriggerTimerConfig {
  cronExpression: string;
  enabled: boolean;
  payload?: string;
}

export interface TriggerHTTPConfig {
  authType: string;
  methods: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH')[];
}

export type TriggerConfig = TriggerTimerConfig;

export interface TriggerModifyOptions {
  triggerType: 'anonymous' | 'function';
  triggerName: string;
  triggerConfig: TriggerConfig;
  invocationRole?: string;
  qualifier?: string;
  sourceArn?: string;
}

export interface CustomDomainModifyOptions {
  certConfig: CertConfig;
  domainName: string;
  protocol: string;
  routeConfig: RouteConfig;
}

export interface ListOptions {
  limit?: number;
  nextToken?: string;
  prefix?: string;
  startKey?: string;
}

export interface ClientConfig {
  accessKeyID: string;
  accessKeySecret: string;
  region: string;
  secure?: string;
  internal?: string;
  timeout?: number;
  securityToken?: string;
  endpoint?: string;
  headers?: Record<string, string>;
}

export class FCClient {
  private accessKeyID: string;
  private securityToken: string | undefined;
  private accessKeySecret: string;
  private endpoint: string | undefined;
  private host: string;
  private version: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(readonly accountId: string, config: ClientConfig) {
    if (!accountId) {
      throw new TypeError('"accountid" must be passed in');
    }

    this.accountId = accountId;

    if (!config) {
      throw new TypeError('"config" must be passed in');
    }

    const accessKeyID = config.accessKeyID;

    if (!accessKeyID) {
      throw new TypeError('"config.accessKeyID" must be passed in');
    }

    this.accessKeyID = accessKeyID;

    if (this.accessKeyID.startsWith('STS')) {
      this.securityToken = config.securityToken;

      if (!this.securityToken) {
        throw new TypeError('"config.securityToken" must be passed in for STS');
      }
    }

    const accessKeySecret = config.accessKeySecret;

    if (!accessKeySecret) {
      throw new TypeError('"config.accessKeySecret" must be passed in');
    }

    this.accessKeySecret = accessKeySecret;

    const region = config.region;

    if (!region) {
      throw new TypeError('"config.region" must be passed in');
    }

    const protocol = config.secure ? 'https' : 'http';

    const internal = config.internal ? '-internal' : '';

    this.endpoint =
      config.endpoint ||
      `${protocol}://${accountId}.${region}${internal}.fc.aliyuncs.com`;
    this.host = `${accountId}.${region}${internal}.fc.aliyuncs.com`;
    this.version = '2016-08-15';
    this.timeout = Number.isFinite(config.timeout) ? config.timeout! : 60000; // default is 60s
    this.headers = config.headers || {};
  }

  buildHeaders(): ClientConfig['headers'] {
    let now = new Date();
    const headers: ClientConfig['headers'] = {
      accept: 'application/json',
      date: now.toUTCString(),
      host: this.host,
      'user-agent': `Node.js(${process.version}) OS(${process.platform}/${process.arch}) SDK(@alicloud/fc2@v2.2.2)`, // fork from @alicloud/fc2@v2.2.2
      'x-fc-account-id': this.accountId,
    };

    if (this.securityToken) {
      headers['x-fc-security-token'] = this.securityToken;
    }

    return headers;
  }

  async request<T>(
    method: string,
    path: string,
    query: RequestQuery | null,
    body: any,
    headers: ClientConfig['headers'],
    opts: RequestExtraOptions = {},
  ): Promise<{
    headers: IncomingHttpHeaders;
    data: T;
  }> {
    let url = `${this.endpoint}/${this.version}${path}`;

    if (query && Object.keys(query).length > 0) {
      url = `${url}?${new URLSearchParams(query).toString()}`;
    }

    headers = Object.assign(this.buildHeaders(), this.headers, headers);
    let postBody;

    if (body) {
      debug('request body: %s', body);
      let buff = null;

      if (Buffer.isBuffer(body)) {
        buff = body;
        headers['content-type'] = 'application/octet-stream';
      } else if (typeof body === 'string') {
        buff = Buffer.from(body, 'utf8');
        headers['content-type'] = 'application/octet-stream';
      } else if ('function' === typeof body.pipe) {
        buff = body;
        headers['content-type'] = 'application/octet-stream';
      } else {
        buff = Buffer.from(JSON.stringify(body), 'utf8');
        headers['content-type'] = 'application/json';
      }

      if ('function' !== typeof body.pipe) {
        const digest = kitx.md5(buff, 'hex');
        const md5 = Buffer.from(digest, 'utf8').toString('base64');

        headers['content-length'] = buff.length;
        headers['content-md5'] = md5;
      }

      postBody = buff;
    }

    let queriesToSign: RequestQuery | undefined;

    if (path.startsWith('/proxy/')) {
      queriesToSign = query || {};
    }

    let signature = FCClient.getSignature(
      this.accessKeyID,
      this.accessKeySecret,
      method,
      `/${this.version}${path}`,
      headers,
      queriesToSign,
    );
    headers['authorization'] = signature;

    debug('request headers: %j', headers);

    const response = await httpx.request(url, {
      method,
      timeout: this.timeout,
      headers,
      data: postBody,
    });

    debug('response status: %s', response.statusCode);
    debug('response headers: %j', response.headers);
    let responseBody: any;

    if (!opts['rawBuf'] || response.headers['x-fc-error-type']) {
      responseBody = await httpx.read(response, 'utf8');
    } else {
      responseBody = await httpx.read(response, undefined as unknown as string);
    }

    debug('response body: %s', responseBody);

    const contentType = response.headers['content-type'] || '';

    if (contentType.startsWith('application/json')) {
      try {
        responseBody = JSON.parse(responseBody);
      } catch (ex) {
        // TODO: add extra message
        throw ex;
      }
    }

    if (response.statusCode! < 200 || response.statusCode! >= 300) {
      const code = response.statusCode;
      const requestid = response.headers['x-fc-request-id'];
      let errMsg;

      if (responseBody.ErrorMessage) {
        errMsg = responseBody.ErrorMessage;
      } else {
        errMsg = responseBody.errorMessage;
      }

      const err: any = new Error(
        `${method} ${path} failed with ${code}. requestid: ${requestid}, message: ${errMsg}.`,
      );
      err.name = `FC${responseBody.ErrorCode}Error`;
      err.code = responseBody.ErrorCode;
      throw err;
    }

    return {
      headers: response.headers,
      data: responseBody,
    };
  }

  /*!
   * GET 请求
   *
   * @param {String} path 请求路径
   * @param {Object} query 请求中的 query 部分
   * @param {Object} headers 请求中的自定义 headers 部分
   * @return {Promise} 返回 Response
   */
  get<T>(
    path: string,
    query: RequestQuery | null,
    headers: ClientConfig['headers'],
  ) {
    return this.request<T>('GET', path, query, null, headers);
  }

  /*!
   * POST 请求
   *
   * @param {String} path 请求路径
   * @param {Buffer|String|Object} body 请求中的 body 部分
   * @param {Object} headers 请求中的自定义 headers 部分
   * @param {Object} queries 请求中的自定义 queries 部分
   * @return {Promise} 返回 Response
   */
  post<T>(
    path: string,
    body: any,
    headers: ClientConfig['headers'],
    queries: RequestQuery | null = {},
    opts: RequestExtraOptions = {},
  ) {
    return this.request<T>('POST', path, queries, body, headers, opts);
  }

  /*!
   * PUT 请求
   *
   * @param {String} path 请求路径
   * @param {Buffer|String|Object} body 请求中的 body 部分
   * @param {Object} headers 请求中的自定义 headers 部分
   * @return {Promise} 返回 Response
   */
  put<T>(path: string, body: any, headers: ClientConfig['headers']) {
    return this.request<T>('PUT', path, null, body, headers);
  }

  /*!
   * DELETE 请求
   *
   * @param {String} path 请求路径
   * @param {Object} query 请求中的 query 部分
   * @param {Object} headers 请求中的自定义 headers 部分
   * @return {Promise} 返回 Response
   */
  delete<T>(
    path: string,
    query: RequestQuery,
    headers: ClientConfig['headers'],
  ) {
    return this.request<T>('DELETE', path, query, null, headers);
  }

  /**
   * 创建Service
   *
   * Options:
   * - description Service的简短描述
   * - logConfig log config
   * - role Service role
   *
   * @param {String} serviceName 服务名
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[ServiceResponse])
   */
  createService(
    serviceName: string,
    options: ServiceModifyOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.post(
      '/services',
      Object.assign(
        {
          serviceName,
        },
        options,
      ),
      headers,
    );
  }

  /**
   * 获取Service列表
   *
   * Options:
   * - limit
   * - prefix
   * - startKey
   * - nextToken
   *
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[Service 列表])
   */
  listServices(options: ListOptions = {}, headers?: FCClient['headers']) {
    return this.get('/services', options, headers);
  }

  /**
   * 获取service信息
   *
   * @param {String} serviceName
   * @param {Object} headers
   * @param {String} qualifier
   * @return {Promise} 返回 Object(包含headers和data属性[Service 信息])
   */
  getService(
    serviceName: string,
    headers?: FCClient['headers'],
    qualifier?: string,
  ) {
    return this.get(
      `/services/${getServiceName(serviceName, qualifier)}`,
      null,
      headers,
    );
  }

  /**
   * 更新Service信息
   *
   * Options:
   * - description Service的简短描述
   * - logConfig log config
   * - role service role
   *
   * @param {String} serviceName 服务名
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[Service 信息])
   */
  updateService(
    serviceName: string,
    options: ServiceModifyOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.put(`/services/${serviceName}`, options, headers);
  }

  /**
   * 删除Service
   *
   * @param {String} serviceName
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteService(
    serviceName: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.delete(`/services/${serviceName}`, options, headers);
  }

  /**
   * 创建Function
   *
   * Options:
   * - description function的简短描述
   * - code function代码
   * - functionName
   * - handler
   * - initializer
   * - memorySize
   * - runtime
   * - timeout
   * - initializationTimeout
   *
   * @param {String} serviceName 服务名
   * @param {Object} options Function配置
   * @return {Promise} 返回 Function 信息
   */
  createFunction(
    serviceName: string,
    options: FunctionModifyOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    this.normalizeParams(options);
    return this.post(`/services/${serviceName}/functions`, options, headers);
  }

  normalizeParams(opts: RequestQuery): void {
    if (opts.functionName) {
      opts.functionName = String(opts.functionName);
    }

    if (opts.runtime) {
      opts.runtime = String(opts.runtime);
    }

    if (opts.handler) {
      opts.handler = String(opts.handler);
    }

    if (opts.initializer) {
      opts.initializer = String(opts.initializer);
    }

    if (opts.memorySize) {
      opts.memorySize = parseInt(opts.memorySize, 10);
    }

    if (opts.timeout) {
      opts.timeout = parseInt(opts.timeout, 10);
    }

    if (opts.initializationTimeout) {
      opts.initializationTimeout = parseInt(opts.initializationTimeout, 10);
    }
  }

  /**
   * 获取Function列表
   *
   * Options:
   * - limit
   * - prefix
   * - startKey
   * - nextToken
   *
   * @param {String} serviceName
   * @param {Object} options 选项，optional
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含headers和data属性[Function列表])
   */
  listFunctions(
    serviceName: string,
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
    qualifier?: string,
  ) {
    return this.get(
      `/services/${getServiceName(serviceName, qualifier)}/functions`,
      options,
      headers,
    );
  }

  /**
   * 获取Function信息
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含headers和data属性[Function信息])
   */
  getFunction(
    serviceName: string,
    functionName: string,
    headers?: ClientConfig['headers'],
    qualifier?: string,
  ) {
    return this.get(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}`,
      null,
      headers,
    );
  }

  /**
   * 获取Function Code信息
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含headers和data属性[Function信息])
   */
  getFunctionCode(
    serviceName: string,
    functionName: string,
    headers?: ClientConfig['headers'],
    qualifier?: string,
  ) {
    return this.get(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/code`,
      null,
      headers,
    );
  }

  /**
   * 更新Function信息
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} options Function配置，见createFunction
   * @return {Promise} 返回 Object(包含headers和data属性[Function信息])
   */
  updateFunction(
    serviceName: string,
    functionName: string,
    options: FunctionModifyOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    this.normalizeParams(options);
    const path = `/services/${serviceName}/functions/${functionName}`;
    return this.put(path, options, headers);
  }

  /**
   * 删除Function
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteFunction(
    serviceName: string,
    functionName: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}`;
    return this.delete(path, options, headers);
  }

  /**
   * 调用Function
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} event event信息
   * @param {Object} headers
   * @param {String} qualifier
   * @return {Promise} 返回 Object(包含headers和data属性[返回Function的执行结果])
   */
  invokeFunction(
    serviceName: string,
    functionName: string,
    event: string | Buffer,
    headers?: ClientConfig['headers'],
    qualifier?: string,
    opts?: RequestExtraOptions,
  ) {
    if (event && typeof event !== 'string' && !Buffer.isBuffer(event)) {
      throw new TypeError('"event" must be String or Buffer');
    }

    const path = `/services/${getServiceName(
      serviceName,
      qualifier,
    )}/functions/${functionName}/invocations`;
    return this.post(path, event, headers, null, opts);
  }

  /**
   * 创建Trigger
   *
   * Options:
   * - invocationRole
   * - sourceArn
   * - triggerType
   * - triggerName
   * - triggerConfig
   * - qualifier
   *
   * @param {String} serviceName 服务名
   * @param {String} functionName 服务名
   * @param {Object} options Trigger配置
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性[Trigger信息])
   */
  createTrigger(
    serviceName: string,
    functionName: string,
    options: TriggerModifyOptions,
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}/triggers`;
    return this.post(path, options, headers);
  }

  /**
   * 获取Trigger列表
   *
   * Options:
   * - limit
   * - prefix
   * - startKey
   * - nextToken
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[Trigger列表])
   */
  listTriggers(
    serviceName: string,
    functionName: string,
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}/triggers`;
    return this.get(path, options, headers);
  }

  /**
   * 获取Trigger信息
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {String} triggerName
   * @return {Promise} 返回 Object(包含headers和data属性[Trigger信息])
   */
  getTrigger(
    serviceName: string,
    functionName: string,
    triggerName: string,
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}/triggers/${triggerName}`;
    return this.get(path, null, headers);
  }

  /**
   * 更新Trigger信息
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {String} triggerName
   * @param {Object} options Trigger配置，见createTrigger
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性[Trigger信息])
   */
  updateTrigger(
    serviceName: string,
    functionName: string,
    triggerName: string,
    options: Pick<
      TriggerModifyOptions,
      'invocationRole' | 'qualifier' | 'triggerConfig'
    >,
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}/triggers/${triggerName}`;
    return this.put(path, options, headers);
  }

  /**
   * 删除Trigger
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {String} triggerName
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteTrigger(
    serviceName: string,
    functionName: string,
    triggerName: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    const path = `/services/${serviceName}/functions/${functionName}/triggers/${triggerName}`;
    return this.delete(path, options, headers);
  }

  /**
   * 创建CustomDomain
   *
   * Options:
   * - protocol
   * - routeConfig
   *
   * @param {String} domainName 域名
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[CustomDomainResponse])
   */
  createCustomDomain(
    domainName: string,
    options: CustomDomainModifyOptions,
    headers?: ClientConfig['headers'],
  ) {
    return this.post(
      '/custom-domains',
      Object.assign(
        {
          domainName,
        },
        options,
      ),
      headers,
    );
  }

  /**
   * 获取CustomDomain列表
   *
   * Options:
   * - limit
   * - prefix
   * - startKey
   * - nextToken
   *
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[CustomDomain 列表])
   */
  listCustomDomains(
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.get('/custom-domains', options, headers);
  }

  /**
   * 获取CustomDomain信息
   *
   * @param {String} domainName
   * @return {Promise} 返回 Object(包含headers和data属性[CustomDomain 信息])
   */
  getCustomDomain(domainName: string, headers?: ClientConfig['headers']) {
    return this.get(`/custom-domains/${domainName}`, null, headers);
  }

  /**
   * 更新CustomDomain信息
   *
   * Options:
   * - protocol
   * - routeConfig
   *
   * @param {String} domainName
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[Service 信息])
   */
  updateCustomDomain(
    domainName: string,
    options: CustomDomainModifyOptions,
    headers?: ClientConfig['headers'],
  ) {
    return this.put(`/custom-domains/${domainName}`, options, headers);
  }

  /**
   * 删除CustomDomain
   *
   * @param {String} domainName
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteCustomDomain(
    domainName: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.delete(`/custom-domains/${domainName}`, options, headers);
  }

  /**
   * 创建 version
   *
   * @param {String} serviceName
   * @param {String} description
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性[Version 信息])
   */
  publishVersion(
    serviceName: string,
    description: string,
    headers?: ClientConfig['headers'],
  ) {
    let body: RequestQuery = {};

    if (description) {
      body.description = description;
    }

    return this.post(`/services/${serviceName}/versions`, body, headers || {});
  }

  /**
   * 列出 version
   *
   * Options:
   * - limit
   * - nextToken
   * - startKey
   * - direction
   *
   * @param {String} serviceName
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性[Version 信息])
   */
  listVersions(
    serviceName: string,
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.get(`/services/${serviceName}/versions`, options, headers);
  }

  /**
   * 删除 version
   *
   * @param {String} serviceName
   * @param {String} versionId
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteVersion(
    serviceName: string,
    versionId: string,
    headers?: ClientConfig['headers'],
  ) {
    return this.delete(
      `/services/${serviceName}/versions/${versionId}`,
      {},
      headers,
    );
  }

  /**
   * 创建 Alias
   *
   * Options:
   * - description
   * - additionalVersionWeight
   *
   * @param {String} serviceName
   * @param {String} aliasName
   * @param {String} versionId
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  createAlias(
    serviceName: string,
    aliasName?: string,
    versionId?: string,
    options: {
      aliasName?: string;
      versionId?: string;
      description?: string;
      additionalVersionWeight?: Record<string, number>;
    } = {},
    headers?: ClientConfig['headers'],
  ) {
    options.aliasName = aliasName;
    options.versionId = versionId;

    return this.post(`/services/${serviceName}/aliases`, options, headers);
  }

  /**
   * 删除 Alias
   *
   * @param {String} serviceName
   * @param {String} aliasName
   * @param {String} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteAlias(
    serviceName: string,
    aliasName: string,
    headers?: ClientConfig['headers'],
  ) {
    return this.delete(
      `/services/${serviceName}/aliases/${aliasName}`,
      {},
      headers,
    );
  }

  /**
   * 列出 alias
   *
   * Options:
   * - limit
   * - nextToken
   * - prefix
   * - startKey
   *
   * @param {String} serviceName
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  listAliases(
    serviceName: string,
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.get(`/services/${serviceName}/aliases`, options, headers);
  }

  /**
   * 获得 alias
   *
   * @param {String} serviceName
   * @param {String} aliasName
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  getAlias(
    serviceName: string,
    aliasName: string,
    headers: ClientConfig['headers'],
  ) {
    return this.get(
      `/services/${serviceName}/aliases/${aliasName}`,
      null,
      headers,
    );
  }

  /**
   * 更新 alias
   *
   * Options:
   * - description
   * - additionalVersionWeight
   *
   * @param {String} serviceName
   * @param {String} aliasName
   * @param {String} versionId
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  updateAlias(
    serviceName: string,
    aliasName: string,
    versionId?: string,
    options: {
      description?: string;
      versionId?: string;
      additionalVersionWeight?: Record<string, number>;
    } = {},
    headers?: ClientConfig['headers'],
  ) {
    if (versionId) {
      options.versionId = versionId;
    }

    return this.put(
      `/services/${serviceName}/aliases/${aliasName}`,
      options,
      headers,
    );
  }

  /**
   * 给fc资源打tag
   *
   * @param {String} resourceArn Resource ARN. Either full ARN or partial ARN.
   * @param {Object} tags  A list of tag keys. At least 1 tag is required. At most 20. Tag key is required, but tag value is optional.
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  tagResource(
    resourceArn: string,
    tags: Record<string, string>,
    options: {
      resourceArn?: string;
      tags?: Record<string, string>;
    } = {},
    headers?: ClientConfig['headers'],
  ) {
    options.resourceArn = resourceArn;
    options.tags = tags;

    return this.post('/tag', options, headers);
  }

  /**
   * 给fc资源取消tag
   *
   * @param {String} resourceArn Resource ARN. Either full ARN or partial ARN.
   * @param {Object} tagkeys  A list of tag keys. At least 1 tag key is required if all=false. At most 20.
   * @param {Boolean} all Remove all tags at once. Default value is false. Accept value: true or false.
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  untagResource<T>(
    resourceArn: string,
    tagKeys: string[],
    all = false,
    options: {
      resourceArn?: string;
      tagKeys?: string[];
      all?: boolean;
    } = {},
    headers: ClientConfig['headers'],
  ) {
    options.resourceArn = resourceArn;
    options.tagKeys = tagKeys;
    options.all = all;
    return this.request<T>('DELETE', '/tag', null, options, headers);
  }

  /**
   * 获取某个资源的所有tag
   *
   * @param {Object} options
   * @param {Object} headers
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  getResourceTags(
    options: {
      resourceArn: string;
    },
    headers?: ClientConfig['headers'],
  ) {
    return this.get('/tag', options, headers);
  }

  /**
   * 获取reservedCapacity列表
   *
   * Options:
   * - limit
   * - nextToken
   *
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含headers和data属性[reservedCapacities 列表])
   */
  listReservedCapacities(
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.get('/reservedCapacities', options, headers);
  }

  /**
   * 获取账号下的 provisionConfigs 列表
   *
   * Options:
   * - limit
   * - nextToken
   * - serviceName
   * - qualifier
   *
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[provisionConfigs 列表])
   */
  listProvisionConfigs(
    options: ListOptions = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.get('/provision-configs', options, headers);
  }

  /**
   * 获取单个函数的 provisionConfig
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[provisionConfig 信息])
   */
  getProvisionConfig(
    serviceName: string,
    functionName: string,
    qualifier: string,
    headers?: ClientConfig['headers'],
  ) {
    return this.get(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/provision-config`,
      null,
      headers,
    );
  }

  /**
   * 更新单个函数的 provisionConfig
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[provisionConfig 信息])
   */
  putProvisionConfig(
    serviceName: string,
    functionName: string,
    qualifier: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.put(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/provision-config`,
      options,
      headers,
    );
  }

  /**
   * 删除单个函数的 asyncConfig
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含headers和data属性)
   */
  deleteFunctionAsyncConfig(
    serviceName: string,
    functionName: string,
    qualifier: string,
    headers?: ClientConfig['headers'],
  ) {
    return this.delete(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/async-invoke-config`,
      {},
      headers,
    );
  }

  /**
   * 获取账号下的 asyncConfigs 列表
   *
   * Options:
   * - limit
   * - nextToken
   *
   * @param {Object} options 选项，optional
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[asyncConfigs 列表])
   */
  listFunctionAsyncConfigs(
    serviceName: string,
    functionName: string,
    options: ListOptions,
    headers?: ClientConfig['headers'],
  ) {
    return this.get(
      `/services/${serviceName}/functions/${functionName}/async-invoke-configs`,
      options,
      headers,
    );
  }

  /**
   * 获取单个函数的 asyncConfig
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[asyncConfig 信息])
   */
  getFunctionAsyncConfig(
    serviceName: string,
    functionName: string,
    qualifier: string,
    headers?: ClientConfig['headers'],
  ) {
    return this.get(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/async-invoke-config`,
      null,
      headers,
    );
  }

  /**
   * 更新单个函数的 asyncConfig
   *
   * @param {String} serviceName
   * @param {String} functionName
   * @param {Object} headers
   * @param {String} qualifier 可选
   * @param {Object} options 选项，optional
   * Options:
   * - maxAsyncEventAgeInSeconds
   * - maxAsyncRetryAttempts
   * - {Object} destinationConfig
   *    - {Object} onSuccess
   *        - destination
   *    - {Object} onFailure
   *        - destination
   * @return {Promise} 返回 Object(包含 headers 和 data 属性[asyncConfig 信息])
   */
  putFunctionAsyncConfig(
    serviceName: string,
    functionName: string,
    qualifier: string,
    options = {},
    headers?: ClientConfig['headers'],
  ) {
    return this.put(
      `/services/${getServiceName(
        serviceName,
        qualifier,
      )}/functions/${functionName}/async-invoke-config`,
      options,
      headers,
    );
  }

  /**
   * 获得Header 签名
   *
   * @param {String} accessKeyID
   * @param {String} accessKeySecret
   * @param {String} method : GET/POST/PUT/DELETE/HEAD
   * @param {String} path
   * @param {json} headers : {headerKey1 : 'headValue1'}
   */
  static getSignature(
    accessKeyID: string,
    accessKeySecret: string,
    method: string,
    path: string,
    headers: ClientConfig['headers'] = {},
    queries: RequestQuery | undefined,
  ): string {
    let stringToSign = composeStringToSign(method, path, headers, queries);
    debug('stringToSign: %s', stringToSign);
    let sign = signString(stringToSign, accessKeySecret);
    return `FC ${accessKeyID}:${sign}`;
  }
}
