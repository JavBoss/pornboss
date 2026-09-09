package client

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"javboss/internal/mpv"
)

func (c *Client) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		c.getMergedConfig(w, r)
		return
	}
	if r.Method != http.MethodPatch {
		w.Header().Set("Allow", "GET, PATCH")
		respondJSONError(w, http.StatusMethodNotAllowed, "请求方法无效", "Method not allowed")
		return
	}
	if !localRequestOriginAllowed(r) {
		respondJSONError(w, http.StatusForbidden, "请求来源无效", "Invalid request origin")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxClientRequestBody))
	if err != nil {
		respondJSONError(w, http.StatusBadRequest, "配置请求过大或格式无效", "Configuration request is too large or invalid")
		return
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		respondJSONError(w, http.StatusBadRequest, "配置请求无效", "Invalid configuration request")
		return
	}
	localEntries, remoteEntries, err := splitConfigPayload(payload)
	if err != nil {
		respondJSONError(w, http.StatusBadRequest, err.Error(), err.Error())
		return
	}
	var remoteConfig map[string]string
	if len(remoteEntries) > 0 {
		remoteBody, err := json.Marshal(remoteEntries)
		if err != nil {
			respondJSONError(w, http.StatusInternalServerError, "配置请求编码失败", "Could not encode configuration request")
			return
		}
		response, err := c.remoteRequest(r.Context(), http.MethodPatch, "/config", "", bytes.NewReader(remoteBody), r.Header)
		if err != nil {
			respondJSONError(w, http.StatusBadGateway, "无法连接远端 JavBoss Server", "Could not connect to the remote JavBoss server")
			return
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			writeRemoteResponse(w, response)
			return
		}
		if err := json.NewDecoder(response.Body).Decode(&remoteConfig); err != nil {
			_ = response.Body.Close()
			respondJSONError(w, http.StatusBadGateway, "远端配置响应无效", "The remote configuration response is invalid")
			return
		}
		_ = response.Body.Close()
		c.storeRemoteConfig(remoteConfig)
	}
	if err := c.settings.updatePlayer(localEntries); err != nil {
		respondJSONError(w, http.StatusInternalServerError, "保存本机播放器设置失败", "Could not save local player settings")
		return
	}
	if len(localEntries) > 0 {
		mpv.InvalidateHotkeysCache()
		mpv.InvalidatePlayerConfigCache()
		mpv.ResetPlayerSession()
	}
	if remoteConfig == nil {
		remoteConfig = c.cachedRemoteConfig()
	}
	c.writeMergedConfig(w, remoteConfig)
}

func (c *Client) getMergedConfig(w http.ResponseWriter, r *http.Request) {
	response, err := c.remoteRequest(r.Context(), http.MethodGet, "/config", "", nil, r.Header)
	if err != nil {
		respondJSONError(w, http.StatusBadGateway, "无法连接远端 JavBoss Server", "Could not connect to the remote JavBoss server")
		return
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeRemoteResponse(w, response)
		return
	}
	defer response.Body.Close()
	var config map[string]string
	if err := json.NewDecoder(response.Body).Decode(&config); err != nil {
		respondJSONError(w, http.StatusBadGateway, "远端配置响应无效", "The remote configuration response is invalid")
		return
	}
	if config == nil {
		config = make(map[string]string)
	}
	c.storeRemoteConfig(config)
	c.writeMergedConfig(w, config)
}

func (c *Client) writeMergedConfig(w http.ResponseWriter, remoteConfig map[string]string) {
	config := cloneStringMap(remoteConfig)
	local, err := c.settings.playerConfig()
	if err != nil {
		respondJSONError(w, http.StatusInternalServerError, "读取本机播放器设置失败", "Could not load local player settings")
		return
	}
	for key, value := range local {
		config[key] = value
	}
	config["runtime_client"] = "true"
	config["desktop_integration_enabled"] = "false"
	config["mpv_enabled"] = "true"
	config["browser_playback_only"] = "false"
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(config)
}

func (c *Client) storeRemoteConfig(config map[string]string) {
	c.configMu.Lock()
	c.config = cloneStringMap(config)
	c.configMu.Unlock()
}

func (c *Client) cachedRemoteConfig() map[string]string {
	c.configMu.RLock()
	defer c.configMu.RUnlock()
	return cloneStringMap(c.config)
}

func cloneStringMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
