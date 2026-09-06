package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ThumbnailQueue abstracts the ability to enqueue thumbnail generation tasks.
// RegisterRoutes wires handlers onto the provided router.
func RegisterRoutes(router gin.IRoutes) {
	router.GET("/config", getConfig)
	router.PATCH("/config", updateConfig)
	router.GET("/tools", getTools)
	router.POST("/tools/ffmpeg/download", downloadFFmpeg)
	router.GET("/videos", listVideos)
	router.GET("/videos/screenshots", listVideosScreenshots)
	router.GET("/videos/:id", getVideo)
	router.GET("/videos/:id/streams", getVideoStreams)
	router.GET("/videos/:id/stream", streamVideo)
	router.HEAD("/videos/:id/stream", streamVideo)
	router.GET("/videos/:id/stream.m3u8", streamHLSManifest)
	router.GET("/videos/:id/stream.m3u8/:segment", streamHLSSegment)
	router.GET("/videos/:id/thumbnail", getThumbnail)
	router.PUT("/videos/:id/cover", updateVideoCover)
	router.DELETE("/videos/:id/cover", resetVideoCover)
	router.GET("/videos/:id/screenshots", listVideoScreenshots)
	router.POST("/videos/:id/screenshots", createVideoScreenshot)
	router.GET("/videos/:id/screenshots/:name", getVideoScreenshot)
	router.PUT("/videos/:id/screenshots/:name", uploadVideoScreenshot)
	router.PATCH("/videos/:id/jav-scrape", updateVideoJavScrapeSettings)
	router.GET("/videos/:id/jav-scrape/possible-codes", getVideoJavScrapePossibleCodes)
	router.GET("/videos/:id/jav-scrape/lookup", lookupVideoJavScrape)
	router.POST("/videos/:id/jav-scrape/link", linkVideoExistingJav)
	router.POST("/videos/:id/jav-scrape/manual", manualVideoJavScrape)
	router.DELETE("/videos/:id/screenshots/:name", deleteVideoScreenshot)
	router.PATCH("/videos/:id/locations/:location_id", renameVideoLocation)
	router.DELETE("/videos/:id/locations/:location_id", deleteVideoLocation)
	router.POST("/videos/:id/play", incrementVideoPlayCount)
	router.POST("/videos/play", playVideoFile)
	router.POST("/videos/playlist", playVideoPlaylist)
	router.POST("/videos/open", openVideoFile)
	router.POST("/videos/reveal", revealVideoLocation)

	router.GET("/directories", listDirectories)
	router.POST("/directories", createDirectory)
	router.POST("/directories/pick", pickDirectory)
	router.POST("/directories/:id/process", processDirectory)
	router.POST("/directories/:id/scan", scanDirectory)
	router.PATCH("/directories/:id", updateDirectory)

	router.GET("/tags", listTags)
	router.POST("/tags", createTag)
	router.GET("/tags/categories", listTagCategories)
	router.POST("/tags/categories", createTagCategory)
	router.PUT("/tags/categories/order", reorderTagCategories)
	router.PATCH("/tags/categories/:id", renameTagCategory)
	router.DELETE("/tags/categories/:id", deleteTagCategory)
	router.POST("/tags/category", assignTagsCategory)
	router.PATCH("/tags/:id", renameTag)
	router.DELETE("/tags/:id", deleteTag)
	router.POST("/tags/batch_delete", deleteTagsBatch)

	router.POST("/videos/tags/add", addTagsToVideos)
	router.POST("/videos/tags/remove", removeTagsFromVideos)
	router.POST("/videos/tags/replace", replaceTagsForVideos)

	router.GET("/jav", searchJav)
	router.GET("/jav/filter-options", listJavFilterOptions)
	router.GET("/jav/avsox-redirect", redirectJavAvsox)
	router.GET("/jav/javdb-url", getJavJavDBURL)
	router.GET("/jav/prefixes", listJavPrefixes)
	router.GET("/jav/tags", listJavTags)
	router.GET("/jav/tag-categories", listJavTagCategories)
	router.POST("/jav/tag-categories", createJavTagCategory)
	router.PUT("/jav/tag-categories/order", reorderJavTagCategories)
	router.PATCH("/jav/tag-categories/:id", renameJavTagCategory)
	router.DELETE("/jav/tag-categories/:id", deleteJavTagCategory)
	router.GET("/jav/studios", listJavStudios)
	router.GET("/jav/studios/options", listJavStudioOptions)
	router.GET("/jav/studios/javdb-url", getJavStudioJavDBURL)
	router.POST("/jav/studios/merge", mergeJavStudios)
	router.PATCH("/jav/studios/:id", updateJavStudio)
	router.GET("/jav/studios/:id", getJavStudio)
	router.GET("/jav/series", listJavSeries)
	router.GET("/jav/series/javdb-url", getJavSeriesJavDBURL)
	router.GET("/jav/series/:id", getJavSeries)
	router.GET("/downloader/settings", getDownloaderSettings)
	router.PUT("/downloader/settings", updateDownloaderSettings)
	router.PUT("/downloader/clouddrive2", updateCloudDrive2Settings)
	router.GET("/downloader/clouddrive2/token", getCloudDrive2Token)
	router.POST("/downloader/clouddrive2/test", testCloudDrive2)
	router.GET("/downloads", listDownloadJobs)
	router.POST("/downloads", createDownloadJob)
	router.POST("/downloads/:id/retry", retryDownloadJob)
	router.POST("/downloads/:id/cancel", cancelDownloadJob)
	router.POST("/downloads/:id/reveal", revealDownloadLocation)
	router.DELETE("/downloads/:id", deleteDownloadJob)
	router.POST("/jav/items/:id/sample-images", resolveJavSampleImages)
	router.PUT("/jav/items/:id", updateJavItem)
	router.POST("/jav/tags", createJavTag)
	router.POST("/jav/tags/scraped", createJavScrapedTag)
	router.POST("/jav/tags/organize", organizeJavTags)
	router.POST("/jav/tags/category", assignJavTagsCategory)
	router.PATCH("/jav/tags/:id", renameJavTag)
	router.DELETE("/jav/tags/:id", deleteJavTag)
	router.POST("/jav/tags/batch_delete", deleteJavTagsBatch)
	router.POST("/jav/tags/add", addJavTagsToItems)
	router.POST("/jav/tags/remove", removeJavTagsFromItems)
	router.POST("/jav/tags/replace", replaceJavTagsForItems)
	router.GET("/jav/:code/cover", getJavCover)
	router.PUT("/jav/:code/cover", updateJavCover)
	registerJavFavoriteRoutes(router, "jav", dbFavoriteEntityJav)
	registerJavFavoriteRoutes(router, "idol", dbFavoriteEntityIdol)
	registerJavFavoriteRoutes(router, "studio", dbFavoriteEntityStudio)
	registerJavFavoriteRoutes(router, "series", dbFavoriteEntitySeries)
	router.GET("/jav/idols", listJavIdols)
	router.POST("/jav/idols", createJavIdol)
	router.GET("/jav/idols/options", listJavIdolOptions)
	router.GET("/jav/idols/resolve", resolveJavIdols)
	router.GET("/jav/idols/javdb-url", getJavIdolJavDBURL)
	router.POST("/jav/idols/merge", mergeJavIdols)
	router.PATCH("/jav/idols/:id", updateJavIdol)
	router.GET("/jav/idols/:id/cover-options", listJavIdolCoverOptions)
	router.PUT("/jav/idols/:id/cover", updateJavIdolCover)
	router.GET("/jav/idols/:id", getJavIdol)
}

const (
	dbFavoriteEntityJav    = "jav"
	dbFavoriteEntityIdol   = "idol"
	dbFavoriteEntityStudio = "studio"
	dbFavoriteEntitySeries = "series"
)

func registerJavFavoriteRoutes(router gin.IRoutes, routeEntity string, dbEntity string) {
	base := "/jav/" + routeEntity + "-favorite-groups"
	router.GET(base, listJavFavoriteGroupsFor(dbEntity))
	router.POST(base, createJavFavoriteGroupFor(dbEntity))
	router.PUT(base+"/order", reorderJavFavoriteGroupsFor(dbEntity))
	router.PATCH(base+"/:id", renameJavFavoriteGroupFor(dbEntity))
	router.DELETE(base+"/:id", deleteJavFavoriteGroupFor(dbEntity))
	router.GET(base+"/:id/items", listJavFavoriteGroupItemsFor(dbEntity))
	router.PUT(base+"/:id/item-order", reorderJavFavoriteGroupItemsFor(dbEntity))
	router.POST(base+"/:id/items/remove", removeJavFavoriteGroupItemsFor(dbEntity))
	if routeEntity == "jav" {
		router.GET("/jav/items/:id/favorite-groups", listJavFavoriteGroupIDsFor(dbEntity))
		router.PUT("/jav/items/:id/favorite-groups", replaceJavFavoriteGroupsFor(dbEntity))
		router.POST("/jav/items/favorite-groups/add", addJavsToFavoriteGroups)
		return
	}
	if routeEntity == "series" {
		router.GET("/jav/series/:id/favorite-groups", listJavFavoriteGroupIDsFor(dbEntity))
		router.PUT("/jav/series/:id/favorite-groups", replaceJavFavoriteGroupsFor(dbEntity))
		return
	}
	router.GET("/jav/"+routeEntity+"s/:id/favorite-groups", listJavFavoriteGroupIDsFor(dbEntity))
	router.PUT("/jav/"+routeEntity+"s/:id/favorite-groups", replaceJavFavoriteGroupsFor(dbEntity))
}

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
