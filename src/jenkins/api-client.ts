import axios, {AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse} from "axios";
import {Logger} from "../common/logger";

const qs = require('qs');

export default class APIClient {
    client: AxiosInstance;
    logger: Logger;
    crumb: any;

    /**
     * jenkins remote api access client, only support api-token auth method
     * @param url
     * @param username
     * @param apiToken
     */
    constructor(private readonly url: string, private readonly username: string, private readonly apiToken: string,) {
    }

    async init() {
        this.client = axios.create({
            baseURL: this.url,
            auth: {username: this.username, password: this.apiToken}
        });
        this.logger = new Logger();

        this.client.interceptors.request.use((config: AxiosRequestConfig) => {
            if (config.method === "get" && config.url.indexOf("/api/json") === -1) {
                config.url = `${config.url}/api/json`
            }
            return config;
        });

        this.client.interceptors.response.use((response: AxiosResponse) => {
            this.logger.debug(`url:${response.config.url} response: ${JSON.stringify(response.data)}`);
            return response;
        }, async (error: AxiosError<any>) => {
            const {data} = error?.response;
            const regexp = /<div id=\"error-description\">.*?<\/div>/g;
            let rawErrorMessage = data.message ? data.message : data.match(regexp);
            rawErrorMessage = rawErrorMessage ? rawErrorMessage[0].replace(/(<([^>]+)>)/ig, "").replace(/[\r\n]/g, "") : rawErrorMessage;

            const {response, config} = error;
            if (response.status === 403 || response.status === 401) {
                await this.getCrumb();
                config.baseURL = undefined;
                return await this.client.request(config)
            }
            if (response.status === 404 && error?.request?.method === "GET" && error?.request?.path?.indexOf("/api/json") === -1) {
                config.url = `${error?.request?.path}/api/json`;
                config.baseURL = undefined;
                return await this.client.request(config)
            }

            this.logger.error(`api invoke failed,[${error.config.method}] ${error.config.url},${typeof error.response.data == "string" ? error.response.data : JSON.stringify(error.response.data)}`)
            return Promise.reject(new Error(`${error.message} ${rawErrorMessage ? "(html error message:" + rawErrorMessage + ")" : ''}`));
        });

        await this.getCrumb();
    }

    async getCrumb() {
        try {
            let {data} = await this.get("/crumbIssuer/api/json");
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            const crumbConfig = {};
            crumbConfig[data["crumbRequestField"]] = data.crumb;
            this.crumb = crumbConfig;
            this.logger.debug(`refresh crumb:${JSON.stringify(this.crumb)}`);
        } catch (e) {
            throw new Error(
                "CSRF protection is not enabled on the server at the moment." +
                " Perhaps the client was initialized when the CSRF setting was" +
                " enabled. Please re-initialize the client, also the root cause:" + e.message
            )
        }
    }

    async get(path: string, options?: AxiosRequestConfig) {
        return this.client.get(path, Object.assign({headers: this.crumb}, options || {}))
    }

    async post(path: string, data: any = {}, options?: AxiosRequestConfig) {
        if (data.json) {
            Object.keys(this.crumb).map(k => data.json[k] = this.crumb[k]);
            data.json = JSON.stringify(data.json);
        }
        return this.client.post(path, qs.stringify(data), Object.assign({headers: this.crumb}, options || {"content-type": "application/x-www-form-urlencoded"}))
    }

    async postConfig(path: string, data: any = {}, options?: AxiosRequestConfig) {
        return this.client.post(path, data, Object.assign({headers: this.crumb}, options || {"content-type": "text/xml"}))
    }

}