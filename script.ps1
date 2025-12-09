# Set kubeconfig
$env:KUBECONFIG = "C:\Users\ws_htu1820\Downloads\k8s-1-34-1-do-1-blr1-1765277922438-kubeconfig.yaml"
# Apply manifests 
kubectl apply -f caddy-configmap.yml
kubectl apply -f caddy.deployment.yml
kubectl apply -f loadbalancer.service.yml

# Wait for LoadBalancer IP
Write-Host "Waiting for LoadBalancer IP..."
do {
    $ip = kubectl get service loadbalancer-service -n default -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
    if ($ip) {
        Write-Host "LoadBalancer IP: $ip"
        break
    }
    Start-Sleep -Seconds 10
} while ($true)


# update dns record with the loadbalancer IP
# for dynamic routing- *.lovableaiweb.info
# Type - A record
# Name - *
# Value - loadbalancer IP

# for static routing- lovableaiweb.info
# Type - A record
# Name - @
# Value - loadbalancer IP


# nslookup lovableaiweb.info
