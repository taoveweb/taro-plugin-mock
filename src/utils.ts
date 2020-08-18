import * as path from 'path'

import * as glob from 'glob'
import { pathToRegexp } from 'path-to-regexp'
import * as bodyParser from 'body-parser'
import { isEmptyObject, createBabelRegister, fs, getModuleDefaultExport } from '@tarojs/helper'

export const MOCK_DIR = 'mock'
export const HTTP_METHODS = ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH']

export function getMockConfigs ({
  appPath,
  mocks
}: {
  appPath: string,
  mocks?: {
    [key: string]: any
  }
}) {
  const mockDir = path.join(appPath, MOCK_DIR)
  let mockConfigs = {}
  if (fs.existsSync(mockDir)) {
    const mockFiles = glob.sync('**/*.[tj]s', {
      cwd: mockDir
    })
    if (mockFiles.length) {
      const absMockFiles = mockFiles.map(file => path.join(mockDir, file))
      createBabelRegister({
        only: absMockFiles
      })
      absMockFiles.forEach(absFile => {
        let mockConfig = {}
        try {
          delete require.cache[absFile]
          mockConfig = getModuleDefaultExport(require(absFile))
        } catch (err) {
          throw err
        }
        mockConfigs = Object.assign({}, mockConfigs, mockConfig)
      })
    }
  }
  if (mocks && !isEmptyObject(mocks)) {
    mockConfigs = Object.assign({}, mockConfigs, mocks)
  }
  return mockConfigs
}

export function parseMockApis (mockConfigs) {
  return Object.keys(mockConfigs).map(key => {
    const result = mockConfigs[key]
    let method = 'GET'
    let apiPath
    const keySplit = key.split(/\s+/g)
    if (keySplit.length === 2) {
      method = keySplit[0]
      apiPath = keySplit[1]
      if (!HTTP_METHODS.includes(method)) {
        throw `配置的 HTTP 方法名 ${method} 不正确，应该是 ${HTTP_METHODS.toString()} 中的一员！`
      }
    } else if (keySplit.length === 1) {
      apiPath = keySplit[0]
    }
    const keys = []
    const reg = pathToRegexp(apiPath, keys)
    return {
      apiPath,
      reg,
      keys,
      method,
      result
    }
  })
}

export function getMockApis ({ appPath, mocks }) {
  const mockConfigs = getMockConfigs({ appPath, mocks })
  return parseMockApis(mockConfigs)
}

export function createMockMiddleware ({
  appPath,
  mocks,
  chokidar
}) {
  const mockDir = path.join(appPath, MOCK_DIR)
  const watcher = chokidar.watch(mockDir, { ignoreInitial: true })
  let mockApis = getMockApis({ appPath, mocks })
  watcher.on('change', path => {
    console.log('CHANGED',path);
    mockApis = getMockApis({ appPath, mocks });
  });
  watcher.on('all', () => {
    mockApis = getMockApis({ appPath, mocks })
  })
  process.once('SIGINT', async () => {
    process.exit(1);
    //await watcher.close()
  })
  return (req, res, next) => {
    const { path: reqPath, method: reqMethod } = req
    let matched: any = false
    mockApis.forEach(mock => {
      const { method, reg, keys } = mock
      if (method.toUpperCase() === reqMethod.toUpperCase()) {
        const match = reg.exec(reqPath)
        if (match) {
          const params = {}
          for (let i = 0; i < keys.length; i++) {
            const keyItem = keys[i] as any
            const name = keyItem.name
            const matchVal = decodeURIComponent(match[i + 1])
            if (matchVal) {
              params[name] = matchVal
            }
          }
          req.params = params
          matched = mock
        }
      }
    })
    if (matched) {
      const { result } = matched
      if (typeof result === 'object') {
        bodyParser.json()(req, res, () => {
          res.json(result)
        })
      } else if (typeof result === 'string') {
        bodyParser.text()(req, res, () => {
          res.send(result)
        })
      } else if (typeof result === 'function') {
        (result as Function)(req, res, next)
      } else {
        next()
      }
    } else {
      next()
    }
  }
}
