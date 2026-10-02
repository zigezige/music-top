import { describe, expect, it } from "vitest";
import {
  QqMusicCatalogProvider,
  type QqMusicFetch,
} from "../src/catalog/qqmusic-provider.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function singerId(mid: string, name: string): string {
  return `qqmusic:${Buffer.from(JSON.stringify([mid, name])).toString("base64url")}`;
}

describe("QqMusicCatalogProvider", () => {
  it("searches QQ singers through Smartbox and preserves the source MID", async () => {
    let requestUrl = "";
    const fetcher: QqMusicFetch = async (input) => {
      requestUrl = input;
      return jsonResponse({
        status: 200,
        body: {
          response: {
            code: 0,
            data: {
              singer: { itemlist: [{ mid: "0025NhlN2yWrP4", name: "周杰伦", singer: "周杰伦" }] },
            },
          },
        },
      });
    };
    const provider = new QqMusicCatalogProvider(fetcher, "http://qq-api.test");

    await expect(provider.searchArtists("周杰伦")).resolves.toEqual([
      expect.objectContaining({
        id: singerId("0025NhlN2yWrP4", "周杰伦"),
        name: "周杰伦",
        sourceName: "周杰伦",
        sourceArtistId: "0025NhlN2yWrP4",
        disambiguation: "QQ 音乐",
      }),
    ]);
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/getSmartbox");
    expect(url.searchParams.get("key")).toBe("周杰伦");
  });

  it("uses the QQ endpoint's maximum page size so pagination does not skip songs", async () => {
    const songLimits: string[] = [];
    const provider = new QqMusicCatalogProvider(async (input) => {
      const url = new URL(input);
      if (url.pathname === "/getSingerAlbum") {
        return jsonResponse({ code: 0, data: { singer: { data: { total: 0, albumList: [] } } } });
      }
      songLimits.push(url.searchParams.get("limit") ?? "");
      return jsonResponse({ code: 0, data: { singer: { data: { total_song: 0, songlist: [] } } } });
    }, "http://qq-api.test", { pageSize: 100 });

    await provider.getArtistCatalog(singerId("artist-1", "周杰伦"));

    expect(songLimits).toEqual(["60"]);
  });

  it("pages through all singer songs, maps albums, and removes duplicate song MIDs", async () => {
    const requestUrls: string[] = [];
    const fetcher: QqMusicFetch = async (input) => {
      requestUrls.push(input);
      const url = new URL(input);
      if (url.pathname === "/getSingerAlbum") {
        return jsonResponse({
          code: 0,
          data: {
            singer: {
              data: {
                total: 3,
                albumList: [
                  { albumMid: "album-1", albumType: "录音室专辑" },
                  { albumMid: "album-2", albumType: "录音室专辑" },
                  { albumMid: "album-3", albumType: "录音室专辑" },
                ],
              },
            },
          },
        });
      }
      if (url.pathname !== "/getSingerHotsong") return jsonResponse({ code: 0, data: {} });
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        return jsonResponse({
          response: {
            code: 0,
            data: {
              singer: {
                data: {
                  total_song: 3,
                  songlist: [
                    {
                      mid: "song-1",
                      name: "晴天",
                      singer: [{ mid: "artist-1", name: "周杰伦" }],
                      album: { mid: "album-1", pmid: "album-1_pic5", name: "叶惠美", time_public: "2003-07-31" },
                    },
                    {
                      mid: "song-2",
                      name: "七里香",
                      singer: [{ mid: "artist-1", name: "周杰伦" }],
                      album: { mid: "album-2", name: "七里香", time_public: "2004-08" },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      return jsonResponse({
        code: 0,
        data: {
          singer: {
            data: {
              total_song: 3,
              songlist: [
                {
                  mid: "song-2",
                  name: "七里香",
                  singer: [{ mid: "artist-1", name: "周杰伦" }],
                  album: { mid: "album-2", name: "七里香", time_public: "2004-08" },
                },
                {
                  mid: "song-3",
                  name: "搁浅",
                  singer: [{ mid: "artist-1", name: "周杰伦" }],
                  album: { mid: "album-3", name: "七里香", time_public: "2004-08-01" },
                },
              ],
            },
          },
        },
      });
    };
    const provider = new QqMusicCatalogProvider(fetcher, "http://qq-api.test", {
      pageSize: 2,
    });

    const tracks = await provider.getArtistCatalog(singerId("artist-1", "周杰伦"));

    expect(requestUrls
      .filter((input) => new URL(input).pathname === "/getSingerHotsong")
      .map((input) => new URL(input).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(tracks).toEqual([
      expect.objectContaining({
        id: "qqmusic:song-1",
        title: "晴天",
        creditedArtists: ["周杰伦"],
        albumTitle: "叶惠美",
        albumCoverUrl: "https://y.gtimg.cn/music/photo_new/T002R300x300M000album-1_pic5.jpg",
        releaseDate: "2003-07-31",
        versionKind: "studio",
        sources: ["qqmusic"],
        outboundLinks: [],
      }),
      expect.objectContaining({ id: "qqmusic:song-2", title: "七里香" }),
      expect.objectContaining({ id: "qqmusic:song-3", title: "搁浅" }),
    ]);
    expect(tracks).toHaveLength(3);
  });

  it("keeps studio recordings, excludes marked live versions, and merges duplicate album releases", async () => {
    const rows = [
      {
        mid: "live-version-code",
        name: "晴天",
        interval: 269,
        version: 3,
        singer: [{ mid: "artist-1", name: "周杰伦" }],
        album: { mid: "live-album", name: "晴天 Live" },
      },
      {
        mid: "live-album-subtitle",
        name: "不能说的秘密",
        interval: 257,
        version: 0,
        singer: [{ mid: "artist-1", name: "周杰伦" }],
        album: { mid: "live-album-2", name: "范特西", subtitle: "2004 Live Edition" },
      },
      {
        mid: "compilation-release",
        name: "晴 天",
        interval: "269",
        singer: [{ mid: "artist-1", name: "周杰伦" }],
        album: {
          mid: "compilation",
          pmid: "compilation-cover",
          name: "周杰伦精选",
          time_public: "2010-01-01",
        },
      },
      {
        mid: "original-release",
        name: "晴天",
        interval: 269,
        singer: [{ mid: "artist-1", name: "周杰伦" }],
        album: {
          mid: "album-1",
          pmid: "album-1_pic5",
          name: "叶惠美",
          time_public: "2003-07-31",
        },
      },
      {
        mid: "alternate-studio-recording",
        name: "晴天",
        interval: 281,
        singer: [{ mid: "artist-1", name: "周杰伦" }],
        album: { mid: "alternate-album", name: "晴天特别版", time_public: "2004-01-01" },
      },
    ];
    const provider = new QqMusicCatalogProvider(async (input) => {
      if (input.includes("getSingerAlbum")) {
        return jsonResponse({
          code: 0,
          data: {
            singer: {
              data: {
                total: 5,
                albumList: [
                  { albumMid: "live-album", albumType: "演唱会专辑" },
                  { albumMid: "live-album-2", albumType: "演唱会专辑" },
                  { albumMid: "compilation", albumType: "精选辑" },
                  { albumMid: "album-1", albumType: "录音室专辑" },
                  { albumMid: "alternate-album", albumType: "Single" },
                ],
              },
            },
          },
        });
      }
      return jsonResponse({
        response: {
          code: 0,
          data: { singer: { data: { total_song: rows.length, songlist: rows } } },
        },
      });
    }, "http://qq-api.test");

    const tracks = await provider.getArtistCatalog(singerId("artist-1", "周杰伦"));

    expect(tracks.map((track) => track.id)).toEqual([
      "qqmusic:original-release",
      "qqmusic:alternate-studio-recording",
    ]);
    expect(tracks[0]).toEqual(expect.objectContaining({
      title: "晴天",
      albumTitle: "叶惠美",
      releaseDate: "2003-07-31",
      versionKind: "studio",
    }));
  });

  it("uses QQ album types to exclude concert recordings without treating version codes as studio/live flags", async () => {
    const fetcher: QqMusicFetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/getSingerAlbum") {
        return jsonResponse({
          response: {
            code: 0,
            singer: {
              code: 0,
              data: {
                total: 2,
                albumList: [
                  { albumMid: "live-album", albumType: "演唱会专辑" },
                  { albumMid: "studio-album", albumType: "录音室专辑" },
                ],
              },
            },
          },
        });
      }
      return jsonResponse({
        response: {
          code: 0,
          data: {
            singer: {
              data: {
                total_song: 3,
                songlist: [
                  {
                    mid: "live-snail",
                    name: "蜗牛",
                    interval: 238,
                    version: 0,
                    singer: [{ mid: "artist-1", name: "周杰伦" }],
                    album: { mid: "live-album", name: "范特西PLUS", time_public: "2004-01-01" },
                  },
                  {
                    mid: "studio-snail",
                    name: "蜗牛",
                    interval: 238,
                    version: 3,
                    singer: [{ mid: "artist-1", name: "周杰伦" }],
                    album: { mid: "studio-album", name: "范特西", time_public: "2001-09-14" },
                  },
                  {
                    mid: "unknown-track",
                    name: "未归类歌曲",
                    interval: 200,
                    version: 0,
                    singer: [{ mid: "artist-1", name: "周杰伦" }],
                  },
                ],
              },
            },
          },
        },
      });
    };
    const provider = new QqMusicCatalogProvider(fetcher, "http://qq-api.test");

    const tracks = await provider.getArtistCatalog(singerId("artist-1", "周杰伦"));

    expect(tracks).toEqual([
      expect.objectContaining({
        id: "qqmusic:studio-snail",
        title: "蜗牛",
        albumTitle: "范特西",
        versionKind: "studio",
      }),
    ]);
  });

  it("resolves missing album types and excludes tracks whose studio status remains unknown", async () => {
    const requests: string[] = [];
    const fetcher: QqMusicFetch = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname);
      if (url.pathname === "/getSingerAlbum") {
        return jsonResponse({
          code: 0,
          data: {
            singer: {
              data: {
                total: 1,
                albumList: [{ albumMid: "known-studio", albumType: "录音室专辑" }],
              },
            },
          },
        });
      }
      if (url.pathname === "/getAlbumInfo") {
        const albumMid = url.searchParams.get("albummid");
        return jsonResponse({
          response: {
            code: 0,
            data: albumMid === "missing-studio"
              ? { mid: albumMid, albumType: "Single" }
              : { mid: albumMid, name: "未分类发行" },
          },
        });
      }
      return jsonResponse({
        code: 0,
        data: {
          singer: {
            data: {
              total_song: 3,
              songlist: [
                {
                  mid: "known-studio-song",
                  name: "录音室歌曲",
                  singer: [{ mid: "artist-1", name: "周杰伦" }],
                  album: { mid: "known-studio", name: "录音室专辑" },
                },
                {
                  mid: "fallback-studio-single",
                  name: "单曲发行",
                  singer: [{ mid: "artist-1", name: "周杰伦" }],
                  album: { mid: "missing-studio", name: "单曲发行" },
                },
                {
                  mid: "unknown-album-track",
                  name: "未分类发行歌曲",
                  singer: [{ mid: "artist-1", name: "周杰伦" }],
                  album: { mid: "unknown-album", name: "未分类发行" },
                },
              ],
            },
          },
        },
      });
    };
    const provider = new QqMusicCatalogProvider(fetcher, "http://qq-api.test");

    const tracks = await provider.getArtistCatalog(singerId("artist-1", "周杰伦"));

    expect(requests).toContain("/getAlbumInfo");
    expect(tracks.map((track) => track.id)).toEqual([
      "qqmusic:known-studio-song",
      "qqmusic:fallback-studio-single",
    ]);
  });

  it("accepts the direct response shape and rejects unavailable QQ API responses", async () => {
    const direct = new QqMusicCatalogProvider(async (input) => {
      if (input.includes("getSingerAlbum")) {
        return jsonResponse({ code: 0, data: { singer: { data: { total: 0, albumList: [] } } } });
      }
      if (input.includes("getSingerHotsong")) {
        return jsonResponse({
          code: 0,
          data: { singer: { data: { total_song: 0, songlist: [] } } },
        });
      }
      return jsonResponse({ code: 0, data: { singer: { list: [] } } });
    }, "http://qq-api.test");
    await expect(direct.searchArtists("不存在")).resolves.toEqual([]);
    await expect(direct.getArtistCatalog(singerId("artist-1", "周杰伦"))).resolves.toEqual([]);

    for (const code of [500, -1]) {
      const unavailable = new QqMusicCatalogProvider(async () => jsonResponse({ code, msg: "failed" }), "http://qq-api.test");
      await expect(unavailable.searchArtists("周杰伦")).rejects.toMatchObject({
        statusCode: 503,
        code: "QQMUSIC_UNAVAILABLE",
      });
    }
  });
});
