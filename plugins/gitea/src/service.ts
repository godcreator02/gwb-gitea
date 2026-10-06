import { Service, type Context } from 'cordis'
import type { HttpArgs } from './core.js'

export interface GiteaResponse {
  status: number
  truncated: boolean
  note?: string
  body: unknown
}

export interface GiteaConnection {
  baseUrl: string
  pushUrl: string
  token: string
}

export type GiteaSendResult = { ok: true; data: GiteaResponse } | { ok: false; error: string }

/** 别的插件 inject 的 gitea 接口：http 与命令 gitea.http 走同一个发送函数；connection 给要自己拼 git 认证或订阅推送的插件 */
export interface GwbGiteaApi {
  /** 2xx/4xx/5xx 都算发出去了、照常返回；参数不对或没发出去才抛 Error */
  http(request: HttpArgs): Promise<GiteaResponse>
  /** 当前设置里的地址、推送地址与 token；token 没配是空字符串 */
  connection(): GiteaConnection
}

/** 只存闭包：cordis 读服务属性时会把属性里存的服务重新绑到调用方上下文，经 this 读存下的 gwbSettings，调用方没 inject 它就是 undefined */
export class GiteaService extends Service implements GwbGiteaApi {
  private readonly sendRequest: (args: unknown) => Promise<GiteaSendResult>
  private readonly readConnection: () => GiteaConnection

  constructor(ctx: Context, sendRequest: (args: unknown) => Promise<GiteaSendResult>, readConnection: () => GiteaConnection) {
    super(ctx, 'gwbGitea')
    this.sendRequest = sendRequest
    this.readConnection = readConnection
  }

  async http(request: HttpArgs): Promise<GiteaResponse> {
    const result = await this.sendRequest(request)
    if (!result.ok) throw new Error(result.error)
    return result.data
  }

  connection(): GiteaConnection {
    return this.readConnection()
  }
}
