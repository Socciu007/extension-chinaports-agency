export interface LoginCredentials {
  username: string
  password: string
  captcha: string
  captchaKey: number
  captchaImgBase: string
}

export const DEFAULT_LOGIN_CREDENTIALS: LoginCredentials = {
  username: 'riverhe@sfyf.cn',
  password: 'x-ODjdJdc79onsoCRKtfiQ',
  captcha: '',
  captchaKey: 0,
  captchaImgBase: '',
}