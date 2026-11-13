# JingWork 的平台子系统入口。
location = /work {
    return 308 /work/;
}

location = /work/sso/callback {
    access_log off;
    error_log /dev/null;
    proxy_pass http://jingwork-api:5050/api/auth/iam/callback;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /work/api/ {
    proxy_intercept_errors off;
    proxy_pass http://jingwork-api:5050/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Tenant-Id $http_x_tenant_id;
    proxy_set_header X-Tenant-Id-String $http_x_tenant_id_string;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
    client_max_body_size 100m;
}

location /work/ {
    rewrite ^/work/(.*)$ /$1 break;
    proxy_pass http://jingwork-web:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
