import 'idempotent-babel-polyfill'

import { Connector, Listener, generateKey } from 'js-walletconnect-core'
import QRCode from 'qrcode'

let localStorageId = 'wcsmngt'

export default class WalletConnect extends Connector {
  constructor(options) {
    super(options)
    this.canvasElement =
      typeof options.canvasElement !== 'undefined'
        ? options.canvasElement
        : window.document.getElementById('walletconnect-qrcode-canvas')
  }

  //
  //  initiate session
  //
  async initSession() {
    let liveSessions = null
    const savedSessions = this.getLocalSessions()
    if (savedSessions) {
      const openSessions = []
      Object.keys(savedSessions).forEach(sessionId => {
        const session = savedSessions[sessionId]
        const now = Date.now()
        return session.expires > now
      })
      liveSessions = await Promise.all(
        openSessions.map(async session => {
          const accounts = await this._getEncryptedData(
            `/session/${session.sessionId}`
          )
          if (accounts) {
            return {
              ...session,
              accounts
            }
          } else {
            return null
          }
        })
      )
      liveSessions = liveSessions.filter(session => !!session)
    }

    const currentSession = liveSessions ? liveSessions[0] : null

    if (currentSession) {
      this.bridgeUrl = currentSession.bridgeUrl
      this.sessionId = currentSession.sessionId
      this.sharedKey = currentSession.sharedKey
      this.dappName = currentSession.dappName
      this.expires = currentSession.expires
    } else {
      this.createSession()
    }
  }

  //
  // Create session
  //
  async createSession() {
    if (this.sessionId) {
      throw new Error('session already created')
    }

    // create shared key
    if (!this.sharedKey) {
      this.sharedKey = await generateKey()
    }

    // store session info on bridge
    const res = await fetch(`${this.bridgeUrl}/session/new`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })
    if (res.status >= 400) {
      throw new Error(res.statusText)
    }

    // get json
    const body = await res.json()
    // session id
    this.sessionId = body.sessionId

    const sessionData = {
      bridgeUrl: this.bridgeUrl,
      sessionId: this.sessionId,
      sharedKey: this.sharedKey,
      dappName: this.dappName,
      expires: this.expires
    }

    await QRCode.toDataURL(this.canvasElement, JSON.stringify(sessionData), {
      errorCorrectionLevel: 'H'
    })
      .then(url => {
        this.qrcode = url
      })
      .catch(err => {
        console.log(err)
      })

    // sessionId and shared key
    return {
      bridgeUrl: this.bridgeUrl,
      sessionId: this.sessionId,
      sharedKey: this.sharedKey,
      dappName: this.dappName,
      expires: this.expires,
      qrcode: this.qrcode
    }
  }

  //
  // create transaction
  //
  async createTransaction(data = {}) {
    if (!this.sessionId) {
      throw new Error(
        'Create session using `initSession` before sending transaction'
      )
    }

    // encrypt data
    const encryptedData = await this.encrypt(data)

    // store transaction info on bridge
    const res = await fetch(
      `${this.bridgeUrl}/session/${this.sessionId}/transaction/new`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: encryptedData,
          dappName: this.dappName
        })
      }
    )
    if (res.status >= 400) {
      throw new Error(res.statusText)
    }

    // res
    const body = await res.json()

    // return transactionId
    return {
      transactionId: body.transactionId
    }
  }

  //
  // get session status
  //
  getSessionStatus() {
    if (!this.sessionId) {
      throw new Error('sessionId is required')
    }
    return this._getEncryptedData(`/session/${this.sessionId}`, true)
  }

  //
  // get transaction status
  //
  getTransactionStatus(transactionId) {
    if (!this.sessionId || !transactionId) {
      throw new Error('sessionId and transactionId are required')
    }

    return this._getEncryptedData(`/transaction-status/${transactionId}`)
  }

  //
  // Listen for session status
  //
  listenSessionStatus(cb, pollInterval = 1000, timeout = 60000) {
    return new Listener(this, {
      fn: () => {
        return this.getSessionStatus()
      },
      cb,
      pollInterval,
      timeout
    })
  }

  //
  // Listen for session status
  //
  listenTransactionStatus(
    transactionId,
    cb,
    pollInterval = 1000,
    timeout = 60000
  ) {
    return new Listener(this, {
      fn: () => {
        return this.getTransactionStatus(transactionId)
      },
      cb,
      pollInterval,
      timeout
    })
  }

  getLocalSessions() {
    const savedLocal = window.localStorage.getItem(localStorageId)
    let savedSessions = null
    if (savedLocal) {
      savedSessions = JSON.parse(savedLocal)
    }
    return savedSessions
  }

  saveLocalSession(session) {
    const savedLocal = window.localStorage.getItem(localStorageId)
    if (savedLocal) {
      let savedSessions = JSON.parse(savedLocal)
      savedSessions[session.sessionId] = session
      window.localStorage.setItem(localStorageId, JSON.stringify(savedSessions))
    }
  }

  updateLocalSession(session) {
    const savedLocal = window.localStorage.getItem(localStorageId)
    if (savedLocal) {
      let savedSessions = JSON.parse(savedLocal)
      savedSessions[session.sessionId] = {
        ...savedSessions[session.sessionId],
        ...session
      }
      window.localStorage.setItem(localStorageId, JSON.stringify(savedSessions))
    }
  }

  deleteLocalSession(session) {
    const savedLocal = window.localStorage.getItem(localStorageId)
    if (savedLocal) {
      window.localStorage.removeItem(session.sessionId)
    }
  }
}
